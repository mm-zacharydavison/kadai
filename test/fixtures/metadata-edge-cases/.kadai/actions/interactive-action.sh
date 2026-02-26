#!/bin/bash
# kadai:name Interactive Action
# kadai:emoji 🔄
# kadai:description An action that needs stdin
# kadai:interactive true

read -p "Enter your name: " name
echo "Hello, $name!"
