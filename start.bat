@echo off
SETLOCAL EnableExtensions

REM Check if venv exists
IF NOT EXIST "venv" (
    echo ---------------------------------------------------
    echo Creating virtual environment...
    echo ---------------------------------------------------
    python -m venv venv
)

REM Activate venv
echo.
echo Activating virtual environment...
CALL venv\Scripts\activate.bat

REM Install dependencies
echo.
echo ---------------------------------------------------
echo Installing/Updating dependencies...
echo ---------------------------------------------------
pip install -r requirements.txt
IF %ERRORLEVEL% NEQ 0 (
    echo Failed to install dependencies.
    pause
    exit /b %ERRORLEVEL%
)

REM Run the server
echo.
echo ---------------------------------------------------
echo Starting Voice Assistant Server...
echo ---------------------------------------------------
python backend/server.py

pause
