export interface SensorEventJson {
  meta_info: MetaInfo[];
  sensor_data: SensorData[];
  ir_data: IrData[];
  annotations: Annotation[];
  external_data: ExternalData[];
}

export interface MetaInfo {
  device_id: string;
  device_manufacturer: string;
  device_name: string;
  dust_sensor_manufacturer: string;
  dust_sensor_name: string;
  temp_sensor_manufacturer: string;
  temp_sensor_name: string;
  overcurrent_sensor_manufacturer: string;
  overcurrent_sensor_name: string;
  thermal_camera_sensor_manufacturer: string;
  thermal_camera_sensor_name: string;
  installation_environment: string;
  collection_date: string;          // "08-27"
  collection_time: string;          // "00:05:57"
  duration_time: string;
  sensor_types: string;
  cumulative_operating_day: string;
  equipment_history: string;
  "img-id": string;
  location: string;
  filename: string;
  img_name: string;
  img_description: string;
}

interface SensorValue {
  data_unit: string;
  value: number;
  trend: string;
}

export interface SensorData {
  PM10: SensorValue[];
  "PM2.5": SensorValue[];
  "PM1.0": SensorValue[];
  NTC: SensorValue[];
  CT1: SensorValue[];
  CT2: SensorValue[];
  CT3: SensorValue[];
  CT4: SensorValue[];
}

export interface IrData {
  temp_max: Array<{
    value_TGmx: number;
    X_Tmax: number;
    Y_Tmax: number;
  }>;
}

export interface Annotation {
  tagging: Array<{
    annotation_type: string;
    state: string; // "0"=정상, "1"=경고, "2"=이상
  }>;
}

export interface ExternalData {
  ex_temperature: SensorValue[];
  ex_humidity: SensorValue[];
  ex_illuminance: SensorValue[];
}
