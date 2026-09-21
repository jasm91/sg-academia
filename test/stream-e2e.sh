#!/usr/bin/env bash
# E2E de transmisión propia contra un LMS local (:3000) + MediaMTX local (RTMP :11935, HLS :18888).
# Requiere ffmpeg. Uso: bash test/stream-e2e.sh
set -u
BASE=${BASE:-http://localhost:3000}; RTMP=${RTMP:-11935}; HLS=${HLS:-18888}
pass=0; fail=0; ok(){ if [ "$1" = "1" ]; then pass=$((pass+1)); echo "  ✓ $2"; else fail=$((fail+1)); echo "  ✗ $2"; fi; }
j(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1"; }
AT=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@sg-academia.local","password":"admin1234"}' | j "['token']")
ST=$(curl -s -X POST $BASE/api/auth/register -H 'Content-Type: application/json' -d "{\"name\":\"Ana Stream\",\"email\":\"ana$RANDOM@t.local\",\"password\":\"secreto1\"}" | j "['token']")
CID=$(curl -s $BASE/api/courses | j "[0]['id']"); SLUG=$(curl -s $BASE/api/courses | j "[0]['slug']")
curl -s -X POST $BASE/api/admin/students -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"name":"x","email":"x@x.x"}' >/dev/null
UID_=$(curl -s $BASE/api/me -H "Authorization: Bearer $ST" | j "['user']['id']")
curl -s -X POST $BASE/api/admin/students/$UID_/enroll -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"course_id\":$CID}" >/dev/null
NOW=$(python3 -c "import datetime;print((datetime.datetime.utcnow()+datetime.timedelta(minutes=2)).isoformat()+'Z')")
A=$(curl -s -X POST $BASE/api/admin/aulas -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"course_id\":$CID,\"title\":\"Clase OBS\",\"starts_at\":\"$NOW\",\"duration_min\":30,\"mode\":\"stream\"}")
AID=$(echo "$A" | j "['id']"); KEY=$(echo "$A" | j "['stream_key']")
ok "$([ -n "$KEY" ] && echo 1 || echo 0)" "aula stream creada #$AID con clave"
CRED=$(curl -s $BASE/api/admin/aulas/$AID/stream -H "Authorization: Bearer $AT")
ok "$(echo "$CRED" | grep -q "rtmp://localhost:$RTMP/aula$AID" && echo 1 || echo 0)" "credenciales OBS: $(echo "$CRED" | j "['publish']['rtmp_server']")"
J=$(curl -s -X POST $BASE/api/aulas/$AID/join -H "Authorization: Bearer $ST")
HLSURL=$(echo "$J" | j "['join']['hls']" | sed "s#https://localhost/#http://localhost:$HLS/#")
ok "$(echo "$J" | grep -q '"whep"' && echo 1 || echo 0)" "alumno recibe whep/hls con token"
# 1) publicar con clave incorrecta → rechazado
timeout 6 ffmpeg -v error -re -f lavfi -i testsrc=size=640x360:rate=25 -f lavfi -i sine=frequency=440 -c:v libx264 -preset ultrafast -tune zerolatency -g 50 -c:a aac -f flv "rtmp://127.0.0.1:$RTMP/aula$AID?user=obs&pass=WRONG" 2>/tmp/ff_wrong.log;
ok "$(grep -qi "error\|refused\|denied\|closed\|Broken\|I/O" /tmp/ff_wrong.log && echo 1 || echo 0)" "publicación con clave incorrecta rechazada"
# 2) publicar con clave correcta durante 20s en background
timeout 22 ffmpeg -v error -re -f lavfi -i testsrc=size=640x360:rate=25 -f lavfi -i sine=frequency=440 -c:v libx264 -preset ultrafast -tune zerolatency -g 50 -pix_fmt yuv420p -c:a aac -ar 44100 -f flv "rtmp://127.0.0.1:$RTMP/aula$AID?user=obs&pass=$KEY" 2>/tmp/ff_ok.log &
sleep 5
STATUS=$(curl -s $BASE/api/aulas/$AID -H "Authorization: Bearer $ST" | j "['status']")
ok "$([ "$STATUS" = "live" ] && echo 1 || echo 0)" "hook ready → aula en estado '$STATUS'"
# 3) leer HLS sin token → 401; con token → 200
NOTOK=$(curl -s -L -c /tmp/cj1 -b /tmp/cj1 -o /dev/null -w '%{http_code}' "http://localhost:$HLS/aula$AID/index.m3u8")
ok "$([ "$NOTOK" = "401" ] && echo 1 || echo 0)" "HLS sin token → $NOTOK"
sleep 2
WITHTOK=$(curl -s -L -c /tmp/cj2 -b /tmp/cj2 -o /tmp/pl.m3u8 -w '%{http_code}' "$HLSURL")
ok "$([ "$WITHTOK" = "200" ] && grep -q EXTM3U /tmp/pl.m3u8 && echo 1 || echo 0)" "HLS con token → $WITHTOK (playlist válida)"
# 4) chat SSE + mensaje
curl -s -N -m 4 "$BASE/api/aulas/$AID/chat/stream?token=$ST" > /tmp/sse.log &
sleep 1
curl -s -X POST $BASE/api/aulas/$AID/chat -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"text":"Hola alumnos"}' >/dev/null
sleep 3
ok "$(grep -q '"Hola alumnos"' /tmp/sse.log && echo 1 || echo 0)" "chat: mensaje del instructor llega por SSE"
ok "$(grep -q '"presence"' /tmp/sse.log && echo 1 || echo 0)" "chat: presencia (conectados) emitida"
wait
sleep 4
STATUS2=$(curl -s $BASE/api/aulas/$AID -H "Authorization: Bearer $ST" | j "['status']")
ok "$([ "$STATUS2" != "live" ] && echo 1 || echo 0)" "hook notready → aula '$STATUS2'"
REC=$(curl -s $BASE/api/aulas/$AID -H "Authorization: Bearer $ST" | j "['recording_lesson_id']")
ok "$([ "$REC" != "None" ] && echo 1 || echo 0)" "grabación publicada como lección #$REC"
ls /tmp/mtxtest/recordings/aula$AID/ 2>/dev/null | head -2
echo; echo "$pass OK, $fail fallos"; [ $fail -eq 0 ]
