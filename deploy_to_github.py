#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WORLD ECHO (世界回声) - GitHub 自动部署与代码同步脚本
基于 Python 原生库编写，无需额外安装 Git 客户端，支持一键上传全栈项目至 GitHub 仓库。
"""

import os
import sys
import json
import base64
import argparse
import urllib.request
import urllib.error

# 项目根目录
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

# 需要上传的项目核心文件清单
CORE_FILES = [
    "index.html",
    "admin.html",
    "README.md",
    "functions/api/echo.js",
    "migrations/0001_init.sql",
    "deploy_to_github.py",
]

def make_request(url, method="GET", token=None, data=None):
    headers = {
        "User-Agent": "World-Echo-Auto-Deployer",
        "Accept": "application/vnd.github.v3+json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if data is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
        body = json.dumps(data).encode("utf-8")
    else:
        body = None

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            return response.status, json.loads(res_body) if res_body else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            err_json = json.loads(err_body)
        except Exception:
            err_json = {"message": err_body}
        return e.code, err_json
    except Exception as e:
        return 0, {"message": str(e)}

def check_token(token):
    print("🔍 正在验证 GitHub 访问凭据...")
    status, res = make_request("https://api.github.com/user", token=token)
    if status == 200:
        login = res.get("login")
        name = res.get("name") or login
        print(f"✅ 登录成功！用户: {name} (@{login})")
        return login
    else:
        print(f"❌ Token 校验失败 ({status}): {res.get('message', '未知错误')}")
        return None

def ensure_repository(token, owner, repo_name, is_private=False):
    repo_full = f"{owner}/{repo_name}"
    print(f"📦 检查目标仓库状态: {repo_full}")
    status, res = make_request(f"https://api.github.com/repos/{repo_full}", token=token)
    
    if status == 200:
        print(f"✅ 目标仓库已存在: https://github.com/{repo_full}")
        return True
    elif status == 404:
        print(f"🚀 仓库不存在，正在自动创建公开仓库 {repo_name}...")
        create_payload = {
            "name": repo_name,
            "description": "WORLD ECHO (世界回声) - 全球匿名文字与语音社区 (Cloudflare Pages + Functions + D1)",
            "private": is_private,
            "auto_init": True
        }
        create_status, create_res = make_request(
            "https://api.github.com/user/repos", 
            method="POST", 
            token=token, 
            data=create_payload
        )
        if create_status in [200, 201]:
            print(f"🎉 仓库创建成功！地址: https://github.com/{repo_full}")
            return True
        else:
            print(f"❌ 创建仓库失败 ({create_status}): {create_res.get('message')}")
            return False
    else:
        print(f"❌ 访问仓库异常 ({status}): {res.get('message')}")
        return False

def get_file_sha(token, repo_full, file_path):
    url = f"https://api.github.com/repos/{repo_full}/contents/{file_path}"
    status, res = make_request(url, token=token)
    if status == 200:
        return res.get("sha")
    return None

def upload_file(token, repo_full, rel_path):
    abs_path = os.path.join(PROJECT_DIR, rel_path.replace("/", os.sep))
    if not os.path.exists(abs_path):
        print(f"⚠️ 文件不存在跳过: {rel_path}")
        return False

    with open(abs_path, "rb") as f:
        content_bytes = f.read()
    b64_content = base64.b64encode(content_bytes).decode("utf-8")

    # 查询当前文件 SHA（用于覆盖更新）
    sha = get_file_sha(token, repo_full, rel_path)

    payload = {
        "message": f"Deploy: Update {rel_path}",
        "content": b64_content,
        "branch": "main"
    }
    if sha:
        payload["sha"] = sha

    url = f"https://api.github.com/repos/{repo_full}/contents/{rel_path}"
    status, res = make_request(url, method="PUT", token=token, data=payload)

    if status in [200, 201]:
        commit_sha = res.get("commit", {}).get("sha", "")[:7]
        action = "更新" if sha else "创建"
        print(f"  [✓] {action} {rel_path} (commit: {commit_sha})")
        return True
    else:
        print(f"  [✗] 同步失败 {rel_path} ({status}): {res.get('message')}")
        return False

def deploy(token, repo_full):
    if "/" not in repo_full:
        print("❌ 仓库格式错误，应为 username/repo-name")
        return False

    owner, repo_name = repo_full.split("/", 1)
    
    # 1. 检验 Token
    login = check_token(token)
    if not login:
        return False

    # 2. 确保仓库存在
    if not ensure_repository(token, owner, repo_name):
        return False

    # 3. 逐个推送文件
    print(f"\n📤 开始同步项目文件至 https://github.com/{repo_full} (分支: main)...")
    success_count = 0
    for rel_path in CORE_FILES:
        if upload_file(token, repo_full, rel_path):
            success_count += 1

    print(f"\n=======================================================")
    print(f"✨ 部署完成！成功同步 {success_count}/{len(CORE_FILES)} 个文件")
    print(f"🔗 GitHub 仓库直达: https://github.com/{repo_full}")
    print(f"💡 下一步：在 Cloudflare Pages 中连接该 GitHub 仓库即可自动上线！")
    print(f"=======================================================\n")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WORLD ECHO GitHub 自动部署工具")
    parser.add_argument("--token", help="GitHub Personal Access Token (PAT)")
    parser.add_argument("--repo", help="目标仓库全名，例如 2713637818qqcom-ctrl/world-echo")

    args = parser.parse_args()

    token = args.token or os.environ.get("GITHUB_TOKEN")
    repo = args.repo or os.environ.get("GITHUB_REPO")

    if not token:
        print("💡 请输入你的 GitHub Personal Access Token (需勾选 repo 权限):")
        token = input("Token: ").strip()

    if not repo:
        print("💡 请输入目标 GitHub 仓库名称 (例如 your-name/world-echo):")
        repo = input("Repository: ").strip()

    if not token or not repo:
        print("❌ 缺少 Token 或仓库名，部署终止。")
        sys.exit(1)

    deploy(token, repo)
