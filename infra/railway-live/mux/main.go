// mux: un solo puerto TCP público (Railway permite un solo TCP proxy) que reparte por el primer byte:
// 0x03 = RTMP (OBS) -> 127.0.0.1:1935 ; STUN/TURN (0x00,0x01,0x40-0x7F) -> 127.0.0.1:3478
package main

import (
	"io"
	"log"
	"net"
	"os"
)

func main() {
	addr := ":9000"
	if p := os.Getenv("MUX_PORT"); p != "" {
		addr = ":" + p
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	log.Println("mux escuchando en", addr)
	for {
		c, err := ln.Accept()
		if err != nil {
			continue
		}
		go handle(c)
	}
}

func handle(c net.Conn) {
	defer c.Close()
	buf := make([]byte, 1)
	if _, err := io.ReadFull(c, buf); err != nil {
		return
	}
	target := "127.0.0.1:3478"
	if buf[0] == 0x03 {
		target = "127.0.0.1:1935"
	}
	up, err := net.Dial("tcp", target)
	if err != nil {
		return
	}
	defer up.Close()
	up.Write(buf)
	done := make(chan struct{}, 2)
	go func() { io.Copy(up, c); done <- struct{}{} }()
	go func() { io.Copy(c, up); done <- struct{}{} }()
	<-done
}
