#!/usr/bin/env bash
# Usage: put your ORIGINAL videos in ./original/ then run: bash optimize-videos.sh
# Output goes to Videos/ (desktop), Videos/mobile/ (phones, smaller) and Videos/posters/ (first-frame images).
# Requires ffmpeg. File names must stay: dawn sunrise morning midday afternoon night
#   entrancegate midpark1 forestpark midpark2 tricourt clubhousepool
set -e
mkdir -p Videos/mobile Videos/posters
for f in original/*.mp4 original/*.MP4 original/*.mov; do
  [ -e "$f" ] || continue
  n=$(basename "${f%.*}" | tr 'A-Z' 'a-z')
  # Desktop: 1280 wide max, ~2-3 Mbps, moov atom first so playback starts before the download finishes
  ffmpeg -y -i "$f" -vf "scale='min(1280,iw)':-2" -c:v libx264 -preset slow -crf 26 \
    -profile:v high -pix_fmt yuv420p -maxrate 3M -bufsize 6M -movflags +faststart \
    -c:a aac -b:a 96k "Videos/$n.mp4"
  # Mobile: 854 wide max, ~1 Mbps
  ffmpeg -y -i "$f" -vf "scale='min(854,iw)':-2" -c:v libx264 -preset slow -crf 29 \
    -profile:v main -pix_fmt yuv420p -maxrate 1200k -bufsize 2400k -movflags +faststart \
    -c:a aac -b:a 64k "Videos/mobile/$n.mp4"
  # Poster (shown instantly while the video buffers)
  ffmpeg -y -ss 1 -i "$f" -frames:v 1 -vf "scale=1280:-2" -q:v 5 "Videos/posters/$n.jpg"
done
echo "Done. Upload the Videos/ folder to your Vercel project."
