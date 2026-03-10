# AGV 데이터셋 스키마 정의

> 출처: [AI Hub - 제조현장 이송장치의 열화 예지보전 멀티모달 데이터](https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=71802)
> 장비: AGV (Autonomous Guided Vehicle, 무인 이송 장치)
> 모델: MiR-100 (비식별화 코드: B1, 제조사: ㈜미르)

---

## 데이터셋 개요

반도체·디스플레이·자동차·의료 등 제조 현장에서 사용되는 AGV의 **열화 예지보전(Predictive Maintenance)** 을 위한 멀티모달 데이터셋.
센서 데이터 + 열화상 이미지(IR)를 결합한 JSON 포맷으로 제공된다.

| 항목 | 내용 |
|------|------|
| 전체 구축량 | 50,530 세트 |
| 1차 개방량 | 7,173 세트 |
| 파일 형식 | JSON (센서) + BIN (열화상 이미지) |

---

## JSON 최상위 구조

```
{
  meta_info    - 장비 및 수집 메타 정보
  sensor_data  - 내부 센서 측정값
  ir_data      - 열화상 카메라 데이터
  annotations  - 라벨링(위험도 상태)
  external_data - 외부 환경 센서 데이터
}
```

---

## 1. `meta_info` - 장비 및 수집 메타 정보

| 필드 | 예시 값 | 설명 |
|------|---------|------|
| `device_id` | `"agv01"` | 장비 고유 ID |
| `device_manufacturer` | `"B"` | 장비 제조사 (비식별화 코드) |
| `device_name` | `"B1"` | 장비 모델명 (비식별화 코드, 실제: MiR-100) |
| `dust_sensor_manufacturer` | `"S01"` | 미세먼지 센서 제조사 (비식별화) |
| `dust_sensor_name` | `"S02"` | 미세먼지 센서 모델명 (비식별화) |
| `temp_sensor_manufacturer` | `"S09"` | 온도 센서 제조사 (비식별화) |
| `temp_sensor_name` | `"S10"` | 온도 센서 모델명 (비식별화) |
| `overcurrent_sensor_manufacturer` | `"S17"` | 과전류 센서 제조사 (비식별화) |
| `overcurrent_sensor_name` | `"S18"` | 과전류 센서 모델명 (비식별화) |
| `thermal_camera_sensor_manufacturer` | `"S25"` | 열화상 카메라 제조사 (비식별화) |
| `thermal_camera_sensor_name` | `"S26"` | 열화상 카메라 모델명 (비식별화) |
| `installation_environment` | `"테스트베드"` | 설치 환경 (테스트베드 / 실제 현장) |
| `collection_date` | `"09-01"` | 데이터 수집 날짜 (MM-DD) |
| `collection_time` | `"08:12:40"` | 데이터 수집 시각 (HH:MM:SS) |
| `duration_time` | `"1"` | 수집 지속 시간 (초) |
| `sensor_types` | `"NTC, PM10, PM2.5, PM1.0, CT1, CT2, CT3, CT4"` | 사용된 센서 타입 목록 |
| `cumulative_operating_day` | `"13"` | AGV 누적 운행 일수 |
| `equipment_history` | `"7"` | 장비 이력 (유지보수 횟수 등) |
| `img-id` | `"agv01_0901_081240"` | 열화상 이미지 고유 ID |
| `location` | `"agv/01/agv01_0901_0812"` | 데이터 저장 경로 |
| `filename` | `"agv01_0901_081240.json"` | 현재 JSON 파일명 |
| `img_name` | `"agv01_0901_081240.bin"` | 대응하는 열화상 이미지 파일명 |
| `img_description` | `"agv01의 현재 내부 온도(최대값)"` | 열화상 이미지 설명 |

---

## 2. `sensor_data` - 내부 센서 측정값

각 센서는 `data_unit`, `value`, `trend` 세 필드를 가진다.

| 필드 | 설명 |
|------|------|
| `data_unit` | 측정 단위 |
| `value` | 측정값 (평균값, avg) |
| `trend` | 추세 방향 (`"1"`: 상승, `"0"`: 유지, `"-1"`: 하강) |

### 센서 항목

| 센서 | 단위 | 설명 |
|------|------|------|
| `PM10` | µg/m³ | 미세먼지 (10µm 이하 입자) |
| `PM2.5` | µg/m³ | 초미세먼지 (2.5µm 이하 입자) |
| `PM1.0` | µg/m³ | 극초미세먼지 (1.0µm 이하 입자) |
| `NTC` | ℃ | AGV 내부 온도 (NTC 서미스터 방식) |
| `CT1` | A | 전류 채널 1 (모터/구동부 전류) |
| `CT2` | A | 전류 채널 2 (모터/구동부 전류) |
| `CT3` | A | 전류 채널 3 (모터/구동부 전류) |
| `CT4` | A | 전류 채널 4 (모터/구동부 전류) |

> CT(Current Transformer): 과전류 감지 센서. 모터 부하 상태 및 이상 전류 감지에 사용.

---

## 3. `ir_data` - 열화상 카메라 데이터

AGV 내부를 촬영한 열화상 이미지에서 추출한 온도 값.

| 필드 | 단위 | 설명 |
|------|------|------|
| `value_TGmx` | ℃ | 열화상 이미지 내 최고 온도 값 |
| `X_Tmax` | px | 최고 온도 위치의 X 좌표 (픽셀) |
| `Y_Tmax` | px | 최고 온도 위치의 Y 좌표 (픽셀) |

> 대응 이미지 파일(`.bin`)과 함께 사용하여 공간적 열 분포 분석에 활용.

---

## 4. `annotations` - 라벨링 (위험도 상태)

| 필드 | 설명 |
|------|------|
| `annotation_type` | 어노테이션 방식 (`"tagging"` 고정) |
| `state` | 위험도 상태 코드 |

### 위험도 상태 코드

| `state` 값 | 상태 | 분포 비율 |
|-----------|------|----------|
| `"0"` | 정상 (Normal) | 41.77% |
| `"1"` | 관심 (Caution) | 25.33% |
| `"2"` | 경고 (Warning) | 25.46% |
| `"3"` | 위험 (Danger) | 7.44% |

---

## 5. `external_data` - 외부 환경 센서 데이터

AGV가 운행되는 주변 환경 측정값. `sensor_data`와 동일한 `data_unit`, `value`, `trend` 구조.

| 센서 | 단위 | 설명 |
|------|------|------|
| `ex_temperature` | ℃ | 외부(주변) 온도 |
| `ex_humidity` | % | 외부(주변) 상대 습도 |
| `ex_illuminance` | lux | 외부(주변) 조도 (빛의 밝기) |

---

## 파일명 규칙

```
{device_id}_{collection_date}_{collection_time}.json
예: agv01_0901_081240.json
    └─── agv01: 장비 ID
         └──── 0901: 수집 날짜 (09월 01일)
               └─── 081240: 수집 시각 (08:12:40)
```

---

## 데이터 흐름 요약

```
JSON 파일
├── meta_info       → 언제, 어디서, 어떤 장비가, 어떤 센서로 수집했는가
├── sensor_data     → 장비 내부 상태 (먼지, 온도, 전류)
├── ir_data         → 열화상 분석 (최고 온도 및 위치)
├── annotations     → 이 시점의 장비 위험도 라벨
└── external_data   → 수집 당시 외부 환경 조건
```
