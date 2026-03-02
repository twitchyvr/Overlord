# Add database module
$serverPath = "C:\Users\mattr\OneDrive\Documents\minimax-local\overlord-web\server.js"
$content = Get-Content $serverPath -Raw -Encoding UTF8

# Add database-module to the list
$content = $content -replace "'./modules/git-module',", "'./modules/git-module',`n    './modules/database-module',"

Set-Content -Path $serverPath -Value $content -Encoding UTF8
Write-Host "Server updated"
