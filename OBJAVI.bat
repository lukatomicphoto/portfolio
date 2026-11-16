@echo off
rem Osvjezi listu fotki i objavi sve izmjene na lukatomic.com (GitHub -> Netlify).
cd /d "%~dp0"
py -c "import PIL" 2>nul || py -m pip install --quiet pillow
py sistem\build.py || python sistem\build.py
if errorlevel 1 ( echo. & echo GRESKA: lista fotki nije napravljena, nista nije objavljeno. & pause & exit /b 1 )

git add -A
git diff --cached --quiet
if not errorlevel 1 ( echo. & echo Nema izmjena - sajt je vec azuran. & pause & exit /b 0 )

echo.
echo Ove izmjene idu na lukatomic.com:
git status --short
echo.
set /p OK=Objaviti? (d/n):
if /i not "%OK%"=="d" ( git reset -q & echo Otkazano, nista nije objavljeno. & pause & exit /b 0 )

git commit -q -m "Izmjena sadrzaja %date% %time:~0,5%"
git push origin main
if errorlevel 1 ( echo. & echo GRESKA: slanje nije uspjelo. Provjeri internet pa pokreni ponovo. & pause & exit /b 1 )
echo.
echo Poslano. Sajt ce biti azuriran za oko minut.
pause
