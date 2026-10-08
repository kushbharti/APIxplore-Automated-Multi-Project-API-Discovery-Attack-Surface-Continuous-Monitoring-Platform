import urllib.request
import json
import time

def request(method, url, data=None):
    req = urllib.request.Request(url, method=method)
    if data:
        req.add_header('Content-Type', 'application/json')
        data = json.dumps(data).encode('utf-8')
    try:
        with urllib.request.urlopen(req, data=data) as res:
            return res.status, json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8'))

def run():
    print("Creating project...")
    status, data = request("POST", "http://localhost:8000/api/v1/projects", {
        "name": "Test Discovery",
        "url": "https://httpbin.org",
        "description": "Test project"
    })
    print("Status:", status)
    print("Project Data:", data)
    
    if status not in (200, 201):
        return

    project_id = data["data"]["id"]
    
    print("Starting discovery...")
    status, data = request("POST", f"http://localhost:8000/api/v1/projects/{project_id}/discover")
    print("Status:", status)
    print("Discovery Data:", data)
    
    if status not in (200, 201, 202):
        return

    run_id = data["data"]["id"]
    
    for i in range(10):
        time.sleep(2)
        status, res = request("GET", f"http://localhost:8000/api/v1/projects/{project_id}/discovery/{run_id}")
        data = res["data"]
        print(f"[{i}] Status: {data['status']}, Candidates: {data['candidates_total']}, State: {data.get('progress_state')}")
        if data["status"] in ["COMPLETED", "FAILED"]:
            break
            
if __name__ == "__main__":
    run()
