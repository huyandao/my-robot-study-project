@echo off
setlocal
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto dependencies

where py >nul 2>&1
if errorlevel 1 goto use_python
py -3.11 -m venv .venv
goto venv_created

:use_python
where python >nul 2>&1
if errorlevel 1 goto python_missing
python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)"
if errorlevel 1 goto python_missing
python -m venv .venv

:venv_created
if errorlevel 1 goto setup_failed

:dependencies
".venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)" >nul 2>&1
if errorlevel 1 goto wrong_venv
".venv\Scripts\python.exe" -c "from importlib.metadata import version; expected={'mujoco':'3.10.0','numpy':'2.4.6','pymycobot':'4.0.5','pyserial':'3.5'}; raise SystemExit(0 if all(version(name)==wanted for name,wanted in expected.items()) else 1)" >nul 2>&1
if not errorlevel 1 goto run

echo Installing project dependencies...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto setup_failed
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto setup_failed

:run
echo Starting myCobot control server at http://127.0.0.1:8000
".venv\Scripts\python.exe" run.py %*
goto end

:python_missing
echo Python 3.11 was not found. Install it from https://www.python.org/downloads/
goto failed

:wrong_venv
echo The existing .venv is not Python 3.11. Delete .venv and run this script again.
goto failed

:setup_failed
echo Failed to create the virtual environment or install dependencies.

:failed
pause
exit /b 1

:end
endlocal
