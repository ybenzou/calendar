$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'resources\generated'
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null
$frames = @()
foreach ($size in @(16,32,48,64,128,256)) {
  $bitmap = [Drawing.Bitmap]::new($size, $size)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform($size / 64.0, $size / 64.0)
  $green = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#245b51'))
  $white = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#f5f2e9'))
  $gold = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#ddb16c'))
  $outline = [Drawing.Drawing2D.GraphicsPath]::new()
  $outline.AddArc(5,9,20,20,180,90); $outline.AddArc(39,9,20,20,270,90)
  $outline.AddArc(39,39,20,20,0,90); $outline.AddArc(5,39,20,20,90,90); $outline.CloseFigure()
  $graphics.FillPath($green,$outline)
  $pen = [Drawing.Pen]::new($white,5)
  $pen.StartCap = [Drawing.Drawing2D.LineCap]::Round; $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($pen,5,24,59,24); $graphics.DrawLine($pen,20,5,20,15); $graphics.DrawLine($pen,44,5,44,15)
  foreach ($point in @(@(19,35),@(31,35),@(43,35),@(19,47),@(31,47))) { $graphics.FillEllipse($white,$point[0]-2.5,$point[1]-2.5,5,5) }
  $graphics.FillRectangle($gold,39,43,9,9)
  $stream = [IO.MemoryStream]::new(); $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
  $frames += ,@{ Size=$size; Bytes=$stream.ToArray() }
  if ($size -eq 64) { $bitmap.Save((Join-Path $assetDirectory 'calendar.png'),[Drawing.Imaging.ImageFormat]::Png) }
  $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $pen.Dispose(); $green.Dispose(); $white.Dispose(); $gold.Dispose(); $outline.Dispose()
}
$file = [IO.File]::Create((Join-Path $assetDirectory 'calendar.ico'))
$writer = [IO.BinaryWriter]::new($file)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($frame in $frames) {
  $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
  $offset += $frame.Bytes.Length
}
foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
$writer.Dispose()
