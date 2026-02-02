@echo off
setlocal enabledelayedexpansion

set ROOT=%~dp0
set PYTHON=%ROOT%python\python.exe
set MANAGE=%ROOT%manage.py
set REQUIREMENTS=%ROOT%requirements.txt

REM Add project root to PYTHONPATH
set PYTHONPATH=%ROOT%;%PYTHONPATH%

REM Ensure pip is installed
"%PYTHON%" -m pip --version >nul 2>&1
if errorlevel 1 (
    echo Pip not found. Installing pip...
    powershell -Command "Invoke-WebRequest https://bootstrap.pypa.io/get-pip.py -OutFile '%ROOT%get-pip.py'"
    "%PYTHON%" "%ROOT%get-pip.py" --no-warn-script-location
    del "%ROOT%get-pip.py"
)

REM Install dependencies
if not exist "%REQUIREMENTS%" (
    echo ERROR: requirements.txt not found
    pause
    exit /b 1
)

echo Installing Python dependencies...
"%PYTHON%" -m pip install --upgrade pip setuptools wheel
"%PYTHON%" -m pip install -r "%REQUIREMENTS%"

if errorlevel 1 (
    echo ERROR: Failed to install some dependencies
    pause
    exit /b 1
)

echo.
echo Dependencies installed successfully!
echo.

REM Start Django server
echo Starting Django server...
"%PYTHON%" "%MANAGE%" runserver 127.0.0.1:8000

pause