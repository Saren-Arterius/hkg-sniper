#!/bin/bash
INTERVAL=60
while true;
  do ./sniper.js;
  echo "Done, sleeping for ${INTERVAL} seconds";
  sleep ${INTERVAL};
done;
