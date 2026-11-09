@echo off
REM Start CV Studio (Windows). First run installs everything into .venv
cd /d "%~dp0"
if not exist .venv (
  echo First start: installing, takes a minute...
  py -3 -m venv .venv || python -m venv .venv
)
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt
python -m cvgen web
pause
