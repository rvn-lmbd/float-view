import { describe, expect, test } from 'vitest';
import { parseFloatyCsv, parseFloatyJson } from './floaty';
import floatyJsonString from './__fixtures__/floaty.json?raw';
import floatyJson from './__fixtures__/floaty.json';
import floatyCsv from './__fixtures__/floaty.csv?raw';

describe(parseFloatyJson.name, () => {
  test('maps gps locations to logs', async () => {
    const { data, units } = await parseFloatyJson(floatyJsonString);
    expect(units).toEqual('metric');
    expect(data).toHaveLength(3);

    expect(data[0]!.gps_latitude).toBe(-1.0);
    expect(data[0]!.gps_longitude).toBe(1.5);
    expect(data[0]!.gps_speed).toBeCloseTo(0.23);
    expect(data[1]!.gps_latitude).toBe(-1.1);
    expect(data[1]!.gps_longitude).toBe(1.6);
    expect(data[1]!.gps_speed).toBeCloseTo(0.77);
    expect(data[2]!.gps_latitude).toBe(-1.1);
    expect(data[2]!.gps_longitude).toBe(1.6);
  });

  test('handles missing data in logs', async () => {
    const { data } = await parseFloatyJson(floatyJsonString);

    // fields set to null

    expect(floatyJson.logs[2]!.batteryCurrent).toBe(null);
    expect(data[1]!.current_battery).toBe(0.4);
    expect(data[2]!.current_battery).toBe(data[1]!.current_battery);

    expect(floatyJson.logs[2]!.batteryVolts).toBe(null);
    expect(data[1]!.voltage).toBe(81.8);
    expect(data[2]!.voltage).toBe(data[1]!.voltage);

    expect(floatyJson.logs[2]!.dutyCycle).toBe(null);
    expect(data[1]!.duty).toBe(4);
    expect(data[2]!.duty).toBe(data[1]!.duty);

    expect(floatyJson.logs[2]!.motorCurrent).toBe(null);
    expect(data[1]!.current_motor).toBe(14);
    expect(data[2]!.current_motor).toBe(data[1]!.current_motor);

    expect(floatyJson.logs[2]!.speed).toBe(null);
    expect(data[1]!.speed).toBe(0.7);
    expect(data[2]!.speed).toBe(data[1]!.speed);

    // fields set to 0

    expect(floatyJson.logs[2]!.controllerTemp).toBe(0);
    expect(data[1]!.temp_mosfet).toBe(18);
    expect(data[2]!.temp_mosfet).toBe(data[1]!.temp_mosfet);

    expect(floatyJson.logs[2]!.motorTemp).toBe(0);
    expect(data[1]!.temp_motor).toBe(21);
    expect(data[2]!.temp_motor).toBe(data[1]!.temp_motor);

    expect(floatyJson.logs[2]!.tripDistance).toBe(0);
    expect(data[1]!.distance).toBe(0.5);
    expect(data[2]!.distance).toBe(data[1]!.distance);
    expect(data[0]!.setpoint).toBeUndefined();
  });

  test('does not treat input tilt as setpoint and reads an explicit setpoint when present', async () => {
    const inputWithFallback = JSON.parse(JSON.stringify(floatyJson));
    inputWithFallback.logs[0].inputTilt = 12;
    const fallbackResult = await parseFloatyJson(JSON.stringify(inputWithFallback));
    expect(fallbackResult.data[0]!.setpoint).toBeUndefined();

    const input = JSON.parse(JSON.stringify(floatyJson));
    input.logs[0].setpoint = 4.25;
    input.logs[0].inputTilt = 12;

    const { data } = await parseFloatyJson(JSON.stringify(input));
    expect(data[0]!.setpoint).toBe(4.25);
  });

  test('maps pitch fields independently and retains remaining distance', async () => {
    const input = JSON.parse(JSON.stringify(floatyJson));
    input.logs[0].pitchAngle = 2.5;
    input.logs[0].truePitchAngle = 1.75;
    input.logs[0].remainingDistance = 35.2;

    const { data } = await parseFloatyJson(JSON.stringify(input));
    expect(data[0]!.pitch).toBe(2.5);
    expect(data[0]!.true_pitch).toBe(1.75);
    expect(data[0]!.remaining_distance).toBe(35.2);
  });
});

describe(parseFloatyCsv.name, () => {
  test('maps floaty csv rows including inline gps', async () => {
    const { data, units, source, errors } = await parseFloatyCsv(floatyCsv);
    expect(errors).toEqual([]);
    expect(source).toBe('floaty');
    expect(units).toEqual('metric');
    expect(data).toHaveLength(3);

    expect(data[0]!.speed).toBe(0.4);
    expect(data[0]!.duty).toBe(3);
    expect(data[0]!.voltage).toBe(81.9);
    expect(data[0]!.gps_latitude).toBe(-1.0);
    expect(data[0]!.gps_longitude).toBe(1.5);
    expect(data[0]!.gps_speed).toBeCloseTo(0.23);
    expect(data[0]!.time).toBe(0);
    expect(data[1]!.time).toBe(0.01);
  });

  test('backfills empty csv cells like floaty json nulls', async () => {
    const { data } = await parseFloatyCsv(floatyCsv);
    expect(data[2]!.current_battery).toBe(data[1]!.current_battery);
    expect(data[2]!.voltage).toBe(data[1]!.voltage);
    expect(data[2]!.duty).toBe(data[1]!.duty);
    expect(data[2]!.speed).toBe(data[1]!.speed);
    expect(data[2]!.temp_mosfet).toBe(data[1]!.temp_mosfet);
    expect(data[2]!.temp_motor).toBe(data[1]!.temp_motor);
    expect(data[2]!.distance).toBe(data[1]!.distance);
  });

  test('backfills the second row from the first row', async () => {
    const header =
      'timestamp,speed,dutyCycle,batteryVolts,tripDistance,latitude,longitude,altitude,accuracy,gpsSpeed,gpsTimestamp';
    const input = `${header}\n1000,1,0.1,80,1,1,2,3,4,5,1000\n1010,,,,,1,2,3,4,5,1010`;
    const { data } = await parseFloatyCsv(input);

    expect(data[1]).toMatchObject({
      speed: 1,
      duty: 10,
      voltage: 80,
      distance: 1,
    });
  });
});

