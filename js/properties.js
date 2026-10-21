'use strict';
/* Generated from project.json by tools/gen_properties.py — do not edit by hand */
const WE_PROPERTIES = {
 "schemecolor": {
  "order": 0,
  "text": "ui_browse_properties_scheme_color",
  "type": "color",
  "value": "0.11 0.35 0.51"
 },
 "zoom": {
  "order": 1,
  "text": "Camera zoom, %",
  "type": "slider",
  "min": 50,
  "max": 250,
  "value": 115
 },
 "camerarotate": {
  "order": 2,
  "text": "Rotate camera",
  "type": "bool",
  "value": false
 },
 "rotationspeed": {
  "order": 3,
  "text": "Rotation speed, °/s",
  "type": "slider",
  "min": 0.2,
  "max": 15,
  "value": 2,
  "fraction": true,
  "precision": 1,
  "condition": "camerarotate.value == true"
 },
 "rotationdirection": {
  "order": 4,
  "text": "Rotation direction",
  "type": "combo",
  "value": "1",
  "condition": "camerarotate.value == true",
  "options": [
   {
    "label": "Clockwise",
    "value": "1"
   },
   {
    "label": "Counter-clockwise",
    "value": "-1"
   }
  ]
 },
 "timemode": {
  "order": 5,
  "text": "Time of day",
  "type": "combo",
  "value": "real",
  "options": [
   {
    "label": "PC system clock",
    "value": "real"
   },
   {
    "label": "Fixed",
    "value": "fixed"
   }
  ]
 },
 "fixedhour": {
  "order": 6,
  "text": "Fixed hour",
  "type": "slider",
  "min": 0,
  "max": 24,
  "value": 12,
  "fraction": true,
  "precision": 1,
  "condition": "timemode.value == 'fixed'"
 },
 "audiosensitivity": {
  "order": 10,
  "text": "Audio sensitivity, %",
  "type": "slider",
  "min": 20,
  "max": 300,
  "value": 100
 },
 "fireintensity": {
  "order": 11,
  "text": "Fire intensity, %",
  "type": "slider",
  "min": 0,
  "max": 200,
  "value": 100
 },
 "flybyfrequency": {
  "order": 12,
  "text": "Fly-by frequency (0 = off)",
  "type": "slider",
  "min": 0,
  "max": 10,
  "value": 5
 },
 "autoflight": {
  "order": 13,
  "text": "Automatic launches / recoveries",
  "type": "bool",
  "value": true
 },
 "missionfrequency": {
  "order": 14,
  "text": "Missions off-screen (0 = off)",
  "type": "slider",
  "min": 0,
  "max": 10,
  "value": 5
 },
 "camerashake": {
  "order": 15,
  "text": "Camera shake on heavy hits",
  "type": "bool",
  "value": true
 },
 "enemies": {
  "order": 16,
  "text": "Enemy aircraft & missiles in combat",
  "type": "bool",
  "value": true
 },
 "fa18count": {
  "order": 40,
  "text": "F/A-18 Hornet — count",
  "type": "slider",
  "min": 0,
  "max": 12,
  "value": 4
 },
 "f14count": {
  "order": 41,
  "text": "F-14 Super Tomcat — count",
  "type": "slider",
  "min": 0,
  "max": 8,
  "value": 2
 },
 "f35count": {
  "order": 42,
  "text": "F-35C Lightning II — count",
  "type": "slider",
  "min": 0,
  "max": 8,
  "value": 2
 },
 "e2dcount": {
  "order": 43,
  "text": "E-2D Hawkeye (AWACS) — count",
  "type": "slider",
  "min": 0,
  "max": 2,
  "value": 1
 },
 "mq25count": {
  "order": 43,
  "text": "MQ-25 Stingray (tanker) — count",
  "type": "slider",
  "min": 0,
  "max": 2,
  "value": 1
 },
 "mh60count": {
  "order": 44,
  "text": "MH-60 Seahawk — count",
  "type": "slider",
  "min": 0,
  "max": 4,
  "value": 1
 },
 "ch53count": {
  "order": 45,
  "text": "CH-53 Sea Stallion — count",
  "type": "slider",
  "min": 0,
  "max": 4,
  "value": 1
 },
 "ah1count": {
  "order": 46,
  "text": "AH-1Z Viper — count",
  "type": "slider",
  "min": 0,
  "max": 4,
  "value": 1
 },
 "cmv22count": {
  "order": 47,
  "text": "CMV-22B Osprey — count",
  "type": "slider",
  "min": 0,
  "max": 4,
  "value": 1
 },
 "ddhelis": {
  "order": 48,
  "text": "Destroyer helicopters (MH-60)",
  "type": "bool",
  "value": true
 },
 "savestate": {
  "order": 49,
  "text": "Remember aircraft in the air between sessions",
  "type": "bool",
  "value": true
 },
 "subtitles": {
  "order": 49,
  "text": "Radio subtitles",
  "type": "bool",
  "value": true
 },
 "carriernumber": {
  "order": 50,
  "text": "Carrier hull number",
  "type": "textinput",
  "value": "07"
 },
 "waveheight": {
  "order": 20,
  "text": "Wave height, %",
  "type": "slider",
  "min": 0,
  "max": 250,
  "value": 100
 },
 "shipspeed": {
  "order": 21,
  "text": "Ship speed, %",
  "type": "slider",
  "min": 0,
  "max": 250,
  "value": 100
 },
 "shadows": {
  "order": 22,
  "text": "Shadows",
  "type": "bool",
  "value": true
 },
 "showpanel": {
  "order": 30,
  "text": "Show control panel",
  "type": "bool",
  "value": true
 },
 "panelposition": {
  "order": 31,
  "text": "Panel position",
  "type": "combo",
  "value": "br",
  "options": [
   {
    "label": "Bottom right",
    "value": "br"
   },
   {
    "label": "Bottom left",
    "value": "bl"
   },
   {
    "label": "Top right",
    "value": "tr"
   },
   {
    "label": "Top left",
    "value": "tl"
   }
  ]
 },
 "panelscale": {
  "order": 32,
  "text": "Panel size, %",
  "type": "slider",
  "min": 60,
  "max": 180,
  "value": 100
 },
 "uicolor": {
  "order": 33,
  "text": "Panel color",
  "type": "color",
  "value": "0.47 0.86 0.67"
 }
};
