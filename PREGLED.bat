@echo off
rem Osvjezi listu fotki i otvori sajt lokalno u pregledacu (nista se ne objavljuje).
cd /d "%~dp0"
py build.py || python build.py
if errorlevel 1 ( echo. & echo GRESKA: lista fotki nije napravljena. & pause & exit /b 1 )
echo.
echo Sajt je otvoren na http://localhost:8123  -  zatvori ovaj prozor kad zavrsis.
start "" http://localhost:8123
py -m http.server 8123 || python -m http.server 8123
