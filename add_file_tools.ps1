# Add file-tools-module to server.js
$serverPath = "C:\Users\mattr\OneDrive\Documents\minimax-local\overlord-web\server.js"
$content = Get-Content $serverPath -Raw -Encoding UTF8

# Add file-tools-module to the list
$content = $content -replace "'./modules/agents-module',", "'./modules/agents-module',`n    './modules/file-tools-module',"

Set-Content -Path $serverPath -Value $content -Encoding UTF8
Write-Host "Server updated"
