@echo off
setlocal enabledelayedexpansion

REM Get root directory (directory of this script)
set ROOT=%~dp0
set FRONTEND=%ROOT%frontend\vite-project
set STATIC=%ROOT%static\frontend
set TEMPLATE=%ROOT%pricing\templates\react.html

echo Building frontend...
cd /d "%FRONTEND%"
call npm run build

echo Copying to static/frontend/...
rmdir /s /q "%STATIC%" 2>nul
mkdir "%STATIC%"
xcopy "%FRONTEND%\dist\*" "%STATIC%\" /e /i /y

REM Get first JS file
for %%f in ("%STATIC%\assets\*.js") do (
    set JS_FILE=%%~nxf
    goto :js_done
)
:js_done

REM Get first CSS file
for %%f in ("%STATIC%\assets\*.css") do (
    set CSS_FILE=%%~nxf
    goto :css_done
)
:css_done

echo Detected: %JS_FILE%, %CSS_FILE%

REM Replace CSS reference in template
powershell -Command "(Get-Content '%TEMPLATE%') -replace 'href=""\{\% static ''frontend/assets/.*\.css'' \%\}""', 'href=""{% static ''frontend/assets/%CSS_FILE%'' %}""' | Set-Content '%TEMPLATE%'"

REM Replace JS reference in template
powershell -Command "(Get-Content '%TEMPLATE%') -replace 'src=""\{\% static ''frontend/assets/.*\.js'' \%\}""', 'src=""{% static ''frontend/assets/%JS_FILE%'' %}""' | Set-Content '%TEMPLATE%'"

echo Done. Template updated with new asset filenames.

endlocal