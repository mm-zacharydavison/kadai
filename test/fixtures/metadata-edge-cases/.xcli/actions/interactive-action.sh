#!/bin/bash
# xcli:name Interactive Action
# xcli:emoji 🔄
# xcli:description An action that needs stdin
# xcli:interactive true

read -p "Enter your name: " name
echo "Hello, $name!"
