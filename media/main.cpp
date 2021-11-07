#include <Arduino.h>

void setup() {
  // put your setup code here, to run once:
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
  Serial.println("setup");
  Serial.println("test");
}

float i=0;
void loop() {
  Serial.println("loop");
  // put your main code here, to run repeatedly:
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println(">led:1");
  delay(50);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println(">led:0");
  delay(50);
  i+=0.1;
  Serial.print(">sin:");
  Serial.println(sin(i));
}