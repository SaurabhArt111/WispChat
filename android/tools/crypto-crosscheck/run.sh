#!/usr/bin/env bash
# Proves the Kotlin E2EE code and the web app's crypto.js agree, in both directions.
# Needs: node 18+, kotlinc. Run from this folder.
set -e
node gen.mjs                                   # web writes vectors with the REAL crypto.js
kotlinc ../../app/src/main/java/com/pingo/app/crypto/E2ee.kt CrossTest.kt -include-runtime -d cross.jar
java -jar cross.jar                            # Kotlin reads web output, then writes its own
node verify.mjs                                # web reads Kotlin output
