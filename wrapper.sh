#!/bin/bash
INTERVAL=60
while true;
  do ./sniper.js;
  sleep ${INTERVAL};
done;
