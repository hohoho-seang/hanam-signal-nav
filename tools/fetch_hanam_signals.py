# -*- coding: utf-8 -*-
"""전국횡단보도표준데이터에서 하남시 보행신호등을 받아 signals.json을 생성/병합한다.

사용법:
  python tools/fetch_hanam_signals.py --key <data.go.kr 디코딩키>          # API에서 하남시 조회
  python tools/fetch_hanam_signals.py --csv <경로> --city 광명시           # CSV로 파이프라인 테스트

동작:
  - 보행자신호등유무=Y 인 횡단보도만 사용.
  - 녹색/적색신호시간이 둘 다 채워져 있으면 cycle:{green,red}로, 아니면 cycle:null(주기 미상).
  - 기존 signals.json(수기 실측 44개)은 그대로 보존 — 15m 이내 근접한 공식 데이터는
    "official" 필드로 실측 옆에 참고 병기만 하고, 겹치지 않는 신규 지점만 추가한다.
    (id 재배정 금지: 기존 id는 Firestore 보정 문서와 연결되어 있음)
  - 신규 항목 id는 기존 마지막 번호 다음부터 이어붙인다.
"""
import argparse
import csv
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API_URL = "https://api.data.go.kr/openapi/tn_pubr_public_crosswalk_api"
ROOT = Path(__file__).resolve().parent.parent
SIGNALS_PATH = ROOT / "signals.json"

# API(JSON) 응답과 CSV 헤더의 필드명이 다르다 — 양쪽 매핑.
FIELD_MAP_API = {
    "lat": "latitude", "lng": "longitude",
    "has_signal": "cartrkSignalLampYn" or "",  # 실제 응답 보고 조정 필요할 수 있음
}

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def detect_encoding(csv_path):
    """공공데이터 CSV는 cp949(포털 일괄파일)와 utf-8-sig(지자체 개별파일)가 혼재한다."""
    for enc in ("utf-8-sig", "cp949", "utf-8"):
        try:
            with open(csv_path, encoding=enc) as f:
                header = f.readline()
            if "위도" in header or "시도명" in header:
                return enc
        except UnicodeDecodeError:
            continue
    raise RuntimeError("CSV 인코딩을 인식하지 못했습니다")


def rows_from_csv(csv_path, city):
    with open(csv_path, encoding=detect_encoding(csv_path)) as f:
        for row in csv.DictReader(f):
            if row.get("시군구명", "").strip() == city:
                yield {
                    "addr": (row.get("소재지도로명주소") or row.get("소재지지번주소") or "").strip(),
                    "lat": row.get("위도", "").strip(),
                    "lng": row.get("경도", "").strip(),
                    "has_signal": row.get("보행자신호등유무", "").strip(),
                    "green": row.get("녹색신호시간", "").strip(),
                    "red": row.get("적색신호시간", "").strip(),
                    "kind": row.get("횡단보도종류", "").strip(),
                    "date": row.get("데이터기준일자", "").strip(),
                }


def rows_from_api(service_key, city):
    """API 페이지네이션 순회. 표준데이터 API의 JSON 필드명은 영문 축약형."""
    page = 1
    while True:
        params = {
            "serviceKey": service_key,
            "pageNo": str(page),
            "numOfRows": "500",
            "type": "json",
            "signguNm": city,
        }
        url = API_URL + "?" + urllib.parse.urlencode(params)
        with urllib.request.urlopen(url, timeout=30) as res:
            data = json.loads(res.read().decode("utf-8"))
        header = data.get("response", {}).get("header", {})
        if header.get("resultCode") not in ("00", "0"):
            raise RuntimeError(f"API 오류: {header}")
        body = data["response"]["body"]
        items = body.get("items", [])
        if isinstance(items, dict):
            items = items.get("item", [])
        if not items:
            break
        for it in items:
            yield {
                "addr": (it.get("rdnmadr") or it.get("lnmadr") or "").strip(),
                "lat": str(it.get("latitude", "")).strip(),
                "lng": str(it.get("longitude", "")).strip(),
                "has_signal": str(it.get("pedSgnlLampYn", it.get("fotSgnlLampYn", ""))).strip(),
                "green": str(it.get("grnSgnlTm", it.get("greenSgnlTm", ""))).strip(),
                "red": str(it.get("redSgnlTm", "")).strip(),
                "kind": str(it.get("crslkKnd", "")).strip(),
                "date": str(it.get("referenceDate", "")).strip(),
            }
        total = int(body.get("totalCount", 0))
        if page * 500 >= total:
            break
        page += 1
        time.sleep(0.3)


def build(rows, dry_run=False):
    existing = json.loads(SIGNALS_PATH.read_text(encoding="utf-8"))
    new_entries = []
    matched_official = 0
    skipped_no_signal = 0
    skipped_no_coord = 0

    for r in rows:
        if r["has_signal"] != "Y":
            skipped_no_signal += 1
            continue
        try:
            lat, lng = float(r["lat"]), float(r["lng"])
        except ValueError:
            skipped_no_coord += 1
            continue

        green = int(r["green"]) if r["green"].isdigit() and int(r["green"]) > 0 else None
        red = int(r["red"]) if r["red"].isdigit() and int(r["red"]) > 0 else None
        official_cycle = {"green": green, "red": red} if (green and red) else None

        # 기존 실측 지점과 15m 이내면: 실측을 유지하고 공식값은 참고로만 병기
        near = None
        for s in existing:
            if haversine(lat, lng, s["lat"], s["lng"]) < 15:
                near = s
                break
        if near is not None:
            if official_cycle:
                near["official"] = official_cycle
                matched_official += 1
            continue

        new_entries.append({
            "name": r["addr"] or f"횡단보도 {lat:.5f},{lng:.5f}",
            "lat": lat,
            "lng": lng,
            "cycle": official_cycle,  # None이면 주기 미상(위치만 표시, 카운트다운 없음)
            "source": "crosswalk-standard-data",
        })

    # id: 기존 것 그대로, 신규만 이어붙임(Firestore 보정 문서와의 매핑 보존)
    next_idx = len(existing)
    for e in new_entries:
        e["id"] = f"sig_{next_idx:02d}"
        next_idx += 1

    merged = existing + new_entries
    print(f"기존(실측) 유지: {len(existing)}")
    print(f"  ㄴ 공식주기 병기됨: {matched_official}")
    print(f"신규 추가: {len(new_entries)}")
    print(f"  ㄴ 주기 있음: {sum(1 for e in new_entries if e['cycle'])}")
    print(f"  ㄴ 주기 미상(위치만): {sum(1 for e in new_entries if not e['cycle'])}")
    print(f"제외 - 신호등 없음: {skipped_no_signal}, 좌표 불량: {skipped_no_coord}")
    print(f"최종 합계: {len(merged)}")

    if not dry_run:
        SIGNALS_PATH.write_text(
            json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"저장됨: {SIGNALS_PATH}")
    return merged


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", help="data.go.kr 디코딩 인증키")
    ap.add_argument("--csv", help="CSV 파일 경로(오프라인 테스트용)")
    ap.add_argument("--city", default="하남시")
    ap.add_argument("--dry-run", action="store_true", help="signals.json을 쓰지 않고 통계만 출력")
    args = ap.parse_args()

    if args.csv:
        rows = rows_from_csv(args.csv, args.city)
    elif args.key:
        rows = rows_from_api(args.key, args.city)
    else:
        sys.exit("--key 또는 --csv 필요")
    build(rows, dry_run=args.dry_run)
