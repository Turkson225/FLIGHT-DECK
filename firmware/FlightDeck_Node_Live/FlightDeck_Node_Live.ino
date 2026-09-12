/* NodeMCU ESP8266: MPU6050 + battery + existing Nano UART + MiFi HTTPS telemetry.
   Monitor only: NO browser commands, stabilization or actuator pin writes. */
#include <Arduino.h>
#include <Wire.h>
#include <ESP8266WiFi.h>
#include <WiFiClientSecureBearSSL.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <sys/time.h>
#include <time.h>
extern "C" {
#include <user_interface.h>
}
#include "Config.h"
#include "TelemetryJson.h"
#include "TrustAnchors.h"
#if __has_include("Secrets.h")
#include "Secrets.h"
#else
#include "Secrets.example.h"
#endif

BearSSL::WiFiClientSecure tls;
BearSSL::X509List roots(TRUST_ROOTS);
BearSSL::Session tlsSession;
HTTPClient http;
ESP8266WebServer diagnostics(80);
fd::UartParser uart;
fd::ReceiverStatus receiver = {};
fd::BatteryPacket battery = {};
live::SensorSample imu;
live::AttitudeEstimate attitude;
uint32_t receiverAt=0,lastSample=0,lastBattery=0,lastPost=0,lastWifiTry=0,lastMpuTry=0;
uint32_t lastLoop=0,rateStart=0,sampleCount=0,sequence=0,backoffUntil=0,lastAccepted=0;
uint32_t lastBatterySample=0;
uint16_t batteryRaw=0;
float measuredHz=0,batteryFiltered=0;
bool haveReceiver=false,mpuReady=false,configured=false;
int lastHttp=0;
char bootId[32]={},payload[4096]={};
const char* lastError="Starting";

bool reached(uint32_t now,uint32_t deadline) { return int32_t(now-deadline)>=0; }
bool clockReady() { return time(nullptr)>1735689600; } // Must have a plausible SNTP UTC clock.
double epochMs() { timeval tv;gettimeofday(&tv,nullptr);return double(tv.tv_sec)*1000.0+tv.tv_usec/1000.0; }
bool uartFresh(uint32_t now) { return haveReceiver&&uint32_t(now-receiverAt)<=livecfg::UART_FRESH_MS; }
bool writeRegister(uint8_t reg,uint8_t value) {
  Wire.beginTransmission(livecfg::MPU_ADDRESS);Wire.write(reg);Wire.write(value);
  return Wire.endTransmission()==0;
}
bool readRegisters(uint8_t reg,uint8_t* bytes,uint8_t size) {
  Wire.beginTransmission(livecfg::MPU_ADDRESS);Wire.write(reg);
  if(Wire.endTransmission(false)!=0)return false;
  if(Wire.requestFrom(livecfg::MPU_ADDRESS,size)!=size)return false;
  for(uint8_t i=0;i<size;++i) {if(!Wire.available())return false;bytes[i]=Wire.read();}
  return true;
}
void probeMpu(uint32_t now) {
  if(mpuReady||now<200||uint32_t(now-lastMpuTry)<2000)return;
  lastMpuTry=now;uint8_t identity=0;
  mpuReady=readRegisters(0x75,&identity,1)&&identity==0x68&&
    writeRegister(0x6B,0x01)&&writeRegister(0x1A,0x03)&&writeRegister(0x19,0x09)&&
    writeRegister(0x1B,0x00)&&writeRegister(0x1C,0x00);
  attitude.reset();
}
void sampleImu(uint32_t now,bool force=false) {
  if(!force&&uint32_t(now-lastSample)<livecfg::SENSOR_PERIOD_MS)return;
  lastSample=now;imu.valid=false;imu.attitudeValid=false;imu.at=now;
  probeMpu(now);if(!mpuReady)return;
  uint8_t bytes[14];if(!readRegisters(0x3B,bytes,sizeof(bytes))) {mpuReady=false;attitude.reset();return;}
  int16_t raw[7];bool allZero=true,clipped=false;
  for(uint8_t i=0;i<7;++i) {
    raw[i]=int16_t((uint16_t(bytes[2*i])<<8)|bytes[2*i+1]);
    allZero&=raw[i]==0;if(i!=3)clipped|=abs(int32_t(raw[i]))>=32760;
  }
  if(allZero||clipped)return;
  for(uint8_t i=0;i<3;++i) {
    const uint8_t a=livecfg::BODY_AXIS[i];
    imu.accel[i]=livecfg::BODY_SIGN[i]*raw[a]*(live::G/16384.0f)-livecfg::ACCEL_BIAS_MS2[i];
    imu.gyro[i]=livecfg::BODY_SIGN[i]*raw[a+4]/131.0f-livecfg::GYRO_BIAS_DPS[i];
  }
  imu.temperature=raw[3]/340.0f+36.53f;
  imu.valid=isfinite(imu.temperature)&&imu.temperature>-40&&imu.temperature<125;
  if(!imu.valid)return;
  ++sampleCount;
  if(uint32_t(now-rateStart)>=1000) {measuredHz=sampleCount*1000.0f/uint32_t(now-rateStart);sampleCount=0;rateStart=now;}
  imu.sampleHz=measuredHz;attitude.update(imu);
}
void pollUart(uint32_t now) {
  for(uint16_t n=0;n<512&&Serial.available();++n) {
    if(!uart.feed(uint8_t(Serial.read()),now)||uart.type()!=2||uart.length()!=sizeof(receiver))continue;
    fd::ReceiverStatus s;memcpy(&s,uart.payload(),sizeof(s));
    if(!live::validReceiver(s))continue;
    if(haveReceiver&&s.bootId==receiver.bootId&&!fd::newer(s.sequence,receiver.sequence))continue;
    receiver=s;receiverAt=now;haveReceiver=true;
  }
}
void discardUartBacklog() {
  for(uint16_t n=0;n<512&&Serial.available();++n)Serial.read();
  uart=fd::UartParser();haveReceiver=false;
}
void sampleBattery(uint32_t now) {
  if(uint32_t(now-lastBatterySample)<200)return;
  lastBatterySample=now;batteryRaw=analogRead(A0);
  batteryFiltered=batteryFiltered==0?batteryRaw:(batteryFiltered*.75f+batteryRaw*.25f);
  const float mv=batteryFiltered*livecfg::MV_PER_COUNT+livecfg::MV_OFFSET;
  battery.valid=livecfg::VOLTAGE_CALIBRATED&&livecfg::MV_PER_COUNT>0&&batteryRaw>2&&batteryRaw<1021&&mv>0&&mv<65000;
  battery.millivolts=battery.valid?uint16_t(mv+.5f):fd::UNKNOWN;
  battery.sampleUptimeMs=now;battery.sampleAgeMs=0;++battery.sequence;
}
void sendBattery(uint32_t now) {
  if(uint32_t(now-lastBattery)<200)return;lastBattery=now;
  battery.sampleAgeMs=fd::age16(now-battery.sampleUptimeMs);
  fd::writeUart(Serial,1,battery);
}
void postTelemetry(uint32_t now) {
  if(!configured||WiFi.status()!=WL_CONNECTED||!clockReady()||!reached(now,backoffUntil)||
    uint32_t(now-lastPost)<livecfg::POST_PERIOD_MS)return;
  lastPost=now;
  // Establish TLS BEFORE capturing the outgoing sample; never send a queued old sample.
  if(!tls.connected()) {
    tls.stop();
    const uint32_t started=millis();
    if(!tls.connect(livecfg::HOST,443)) {
      lastError="TLS/DNS connection failed; check UTC, roots and MiFi";lastHttp=-1;
      backoffUntil=millis()+5000;discardUartBacklog();return;
    }
    if(uint32_t(millis()-started)>livecfg::UART_FRESH_MS)discardUartBacklog();
  }
  now=millis();pollUart(now);sampleImu(now,true);sampleBattery(now);sendBattery(now);
  live::Snapshot s;s.imu=imu;s.receiver=receiver;s.uartFresh=uartFresh(now);
  s.batteryValid=battery.valid&&uint32_t(now-battery.sampleUptimeMs)<=1500;
  s.aircraftVoltage=battery.millivolts/1000.0f;s.wifiConnected=true;s.wifiRssi=WiFi.RSSI();
  s.uptimeMs=now;s.sequence=++sequence;s.sampledAt=epochMs();s.deviceId=livecfg::DEVICE_ID;s.bootId=bootId;
  DynamicJsonDocument doc(4096);
  if(!live::buildTelemetry(doc,s,livecfg::IMU_CALIBRATION_VERIFIED)||measureJson(doc)>=sizeof(payload)) {
    lastError="Telemetry buffer too small";backoffUntil=now+5000;return;
  }
  const size_t length=serializeJson(doc,payload,sizeof(payload));
  http.setReuse(true);http.setTimeout(livecfg::NETWORK_TIMEOUT_MS);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  const String url=String("https://")+livecfg::HOST+livecfg::PATH;
  if(!http.begin(tls,url)) {lastError="HTTP setup failed";backoffUntil=millis()+5000;return;}
  http.addHeader("Content-Type","application/json");http.addHeader("x-device-token",DEVICE_TOKEN);
  const uint32_t requestAt=millis();
  lastHttp=http.POST(reinterpret_cast<uint8_t*>(payload),length);
  // Small authenticated endpoint response; close unexpected/large/unknown-length responses.
  if(http.getSize()>=0&&http.getSize()<=512) {const String ignored=http.getString();(void)ignored;}
  else tls.stop();
  http.end();
  if(uint32_t(millis()-requestAt)>livecfg::UART_FRESH_MS)discardUartBacklog();
  if(lastHttp==200) {lastAccepted=millis();lastError="Telemetry accepted";}
  else if(lastHttp==401||lastHttp==403) {lastError="Device token/JWT configuration rejected";backoffUntil=millis()+15000;}
  else if(lastHttp==400) {lastError="Update telemetry-ingest code; check device ID and schema";backoffUntil=millis()+10000;}
  else if(lastHttp==422) {lastError="Sample too old or UTC clock wrong";backoffUntil=millis()+3000;}
  else if(lastHttp==409) {lastError="Sequence/rate conflict; check duplicate devices";backoffUntil=millis()+1000;}
  else {lastError="Uplink unavailable; check function logs and internet";backoffUntil=millis()+5000;}
  // No failed telemetry or command is retained for replay.
}
void setupDiagnostics() {
  diagnostics.on("/",HTTP_GET,[]{
    // Intentionally only setup/health, no secret, full telemetry, actuator or configuration route.
    String page=F("<!doctype html><meta name='viewport' content='width=device-width'><title>FLIGHT DECK NodeMCU</title><style>body{background:#101410;color:#e8eee3;font:17px system-ui;max-width:700px;margin:40px auto;padding:20px}b{color:#b5e878}code{color:#ff9b63}</style><h1>FLIGHT DECK · NodeMCU</h1><p>Local connection diagnostics. Read-only.</p>");
    page+=String("<p>Device: <code>")+livecfg::DEVICE_ID+"</code></p><p>Wi-Fi: connected · IP "+WiFi.localIP().toString()+"</p>";
    page+=String("<p>UTC clock: ")+(clockReady()?"ready":"waiting for network time")+"</p>";
    page+=String("<p>MPU6050: ")+(imu.valid?"reading":"missing / invalid")+" · Nano UART: "+(uartFresh(millis())?"fresh":"missing / stale")+"</p>";
    page+=String("<p>Battery ADC raw: ")+batteryRaw+" · "+(battery.valid?"calibrated":"not calibrated")+"</p>";
    page+=String("<p>Last HTTP: <b>")+lastHttp+"</b> · "+lastError+"</p>";
    page+=String("<p>Last accepted age: ")+(lastAccepted?String((millis()-lastAccepted)/1000)+" s":"none")+" · Free heap: "+ESP.getFreeHeap()+" bytes</p>";
    page+=F("<p>Open your cloud FLIGHT DECK dashboard and select LIVE. This local page works only on the same network. No actuator controls are provided.</p>");
    diagnostics.sendHeader("Cache-Control","no-store");diagnostics.send(200,"text/html",page);
  });diagnostics.begin();
}
void setup() {
  pinMode(LED_BUILTIN,OUTPUT);digitalWrite(LED_BUILTIN,HIGH);
  Serial.setRxBufferSize(512);Serial.begin(38400);Serial.setDebugOutput(false);
  Wire.begin(livecfg::SDA_PIN,livecfg::SCL_PIN);Wire.setClock(100000);Wire.setClockStretchLimit(1500);
  snprintf(bootId,sizeof(bootId),"esp-%06x-%08x",unsigned(ESP.getChipId()),unsigned(os_random()));
  battery.version=fd::VERSION;battery.bootId=uint16_t(os_random());battery.millivolts=fd::UNKNOWN;
  configured=strcmp(WIFI_SSID,"YOUR_MIFI_NAME")!=0&&strlen(WIFI_SSID)>0&&strlen(DEVICE_TOKEN)>=32&&
    strcmp(DEVICE_TOKEN,"PASTE_YOUR_RANDOM_DEVICE_TOKEN_HERE")!=0;
  tls.setTrustAnchors(&roots);tls.setSession(&tlsSession);tls.setTimeout(livecfg::NETWORK_TIMEOUT_MS);
  tls.setSSLVersion(BR_TLS12,BR_TLS12); // No setInsecure(), certificate bypass or secret redirects.
  WiFi.persistent(false);WiFi.mode(WIFI_STA);WiFi.hostname("flight-deck-node");WiFi.setAutoReconnect(true);
  if(strcmp(WIFI_SSID,"YOUR_MIFI_NAME")!=0)WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
  configTime(0,0,"pool.ntp.org","time.google.com","time.cloudflare.com");
  setupDiagnostics();lastError=configured?"Waiting for Wi-Fi and UTC":"Fill Secrets.h before upload";
}
void loop() {
  uint32_t now=millis();
  if(lastLoop&&uint32_t(now-lastLoop)>livecfg::UART_FRESH_MS)discardUartBacklog();
  lastLoop=now;
  pollUart(now);sampleImu(now);sampleBattery(now);sendBattery(now);
  if(strcmp(WIFI_SSID,"YOUR_MIFI_NAME")!=0&&WiFi.status()!=WL_CONNECTED&&uint32_t(now-lastWifiTry)>15000) {
    lastWifiTry=now;WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
  }
  diagnostics.handleClient();postTelemetry(millis());
  // Built-in LED: fast blink no Wi-Fi; slow blink waiting/error; brief heartbeat when accepted.
  now=millis();const bool accepted=lastAccepted&&uint32_t(now-lastAccepted)<2000;
  const bool light=WiFi.status()!=WL_CONNECTED?(now%400)<200:accepted?(now%2000)<80:(now%1200)<200;
  digitalWrite(LED_BUILTIN,light?LOW:HIGH);yield();
}
