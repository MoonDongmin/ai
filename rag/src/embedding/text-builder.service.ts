import {Injectable} from "@nestjs/common";
import {
  Annotation,
  ExternalData,
  IrData,
  MetaInfo,
  SensorData,
}                   from "@/event/dto/sensor-event.dto";

@Injectable()
export class TextBuilderService {
  build(
    meta: MetaInfo,
    sensors: SensorData,
    ir: IrData,
    annotation: Annotation,
    external: ExternalData) {
    const state: string = annotation.tagging[0].state;
    const stateLabel: "정상" | "경고" | "이상" =
      state === "0"
        ? "정상"
        : state === "1"
          ? "경고"
          : "이상";
    const deviceType: string = meta.device_id.replace(/\d+/g, "").toUpperCase();

    const contextPrefix: string = [
      `[맥락] 이 데이터는 ${meta.installation_environment} 환경에서 설치된`,
      `${deviceType} 유형 산업용 장비 ${meta.device_id}(제조사: ${meta.device_manufacturer}, 모델: ${meta.device_name})의`,
      `${meta.collection_date} ${meta.collection_time} 시점 센서 텔레메트리 기록임.`,
      `장비 위치는 ${meta.location}이며, 누적 가동 ${meta.cumulative_operating_day}일차.`,
      `장비 ${meta.equipment_history}회 이력이 있는 장비의 상태는 "${stateLabel}"으로 판정되었음`,
    ].join(" ");

    const sensorBody: string = [
      `미세먼지: PM10=${sensors.PM10[0].value}µg/m³, PM2.5=${sensors["PM2.5"][0].value}µg/m³, PM1.0=${sensors["PM1.0"][0].value}µg/m³.`,
      `내부온도: NTC=${sensors.NTC[0].value}℃.`,
      `전류: CT1=${sensors.CT1[0].value}A, CT2=${sensors.CT2[0].value}A, CT3=${sensors.CT3[0].value}A, CT4=${sensors.CT4[0].value}A.`,
      `IR 열화상 최대온도: ${ir.temp_max[0].value_TGmx}℃ (좌표: ${ir.temp_max[0].X_Tmax}, ${ir.temp_max[0].Y_Tmax}).`,
      `외부환경: 온도=${external.ex_temperature[0].value}℃, 습도=${external.ex_humidity[0].value}%, 조도=${external.ex_illuminance[0].value}lux.`,
    ].join(" ");

    return `${contextPrefix}\n${sensorBody}`;
  }
}
