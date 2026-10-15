#!/usr/bin/env bash

echo 'Adding node_modules to path'
echo 'export PATH=/workspaces/node_modules/.bin:/workspaces/docsite/node_modules/.bin:$PATH' >> /home/node/.bashrc

echo 'Updating npm...'
npm install -g npm