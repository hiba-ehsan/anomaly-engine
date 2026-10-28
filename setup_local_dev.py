import os
import subprocess
import shutil

services = ["api-gateway", "backtester", "ingestion-market", "ingestion-us", "nlp-engine"]
script_dir = os.path.dirname(os.path.abspath(__file__))
base_dir = os.path.join(script_dir, "services")

for service in services:
    service_dir = os.path.join(base_dir, service)
    venv_dir = os.path.join(service_dir, "venv")
    
    print(f"Setting up {service}...")
    if not os.path.exists(venv_dir):
        print(f"Creating fresh venv for {service}...")
        subprocess.run(["python", "-m", "venv", venv_dir], cwd=service_dir, check=True)
    else:
        print(f"Using existing venv for {service}...")
    
    pip_path = os.path.join(venv_dir, "Scripts", "pip.exe")
    if not os.path.exists(pip_path):
        pip_path = os.path.join(venv_dir, "bin", "pip")
    req_path = os.path.join(service_dir, "requirements.txt")
    
    if os.path.exists(pip_path):
        print(f"Installing dependencies for {service}...")
        if service == "nlp-engine":
            subprocess.run([pip_path, "install", "--extra-index-url", "https://download.pytorch.org/whl/cpu", "-r", req_path], cwd=service_dir, check=True)
        else:
            subprocess.run([pip_path, "install", "-r", req_path], cwd=service_dir, check=True)
    else:
        print(f"ERROR: pip not found in {venv_dir}")

print("Setting up frontend...")
frontend_dir = os.path.join(base_dir, "frontend")
subprocess.run(["npm", "install"], shell=True, cwd=frontend_dir, check=True)

print("Local environment setup complete!")
