#!/bin/bash

npm install --save babel-cli

# just here while we figure out where the hell everything is
ls -l

# obviously we could also put our babel command in here, to create the dist subtree, thusly:
babel -q --compact true --minified -d dist src

ls -l src/

ls -l dist/

# put a temp file in there, for the /hello endpoint (so we know it's all working)
# cp /app/test.js /app/dist/
