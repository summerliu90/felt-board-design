package server

import (
	"bytes"
	"context"
	"davinci/internal/doc"
	"encoding/base64"
	"encoding/json"
	"image/color"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStudioSettingsSecretsAndOrigin(t *testing.T) {
	h := start(t)
	payload := map[string]any{"key": "test-secret-never-return", "endpoint": "https://api.openai.com/v1", "imageModel": "test-image", "layoutModel": "test-layout"}
	code, body := h.do("PUT", "/api/studio/settings", payload)
	if code != 200 || bytes.Contains(body, []byte("test-secret")) {
		t.Fatal(code, string(body))
	}
	code, body = h.do("GET", "/api/studio/settings", nil)
	if code != 200 || !bytes.Contains(body, []byte(`"configured":true`)) || bytes.Contains(body, []byte("test-secret")) {
		t.Fatal(code, string(body))
	}
	info, err := os.Stat(filepath.Join(h.srv.dataDir, "studio-settings.json"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("secret file permissions", info, err)
	}
	delete(payload, "key")
	h.do("PUT", "/api/studio/settings", payload)
	cfg, _ := h.srv.readStudioSettings()
	if cfg.Key != "test-secret-never-return" {
		t.Fatal("blank update lost key")
	}
	req, _ := http.NewRequest("PUT", h.url("/api/studio/settings"), strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://untrusted.example")
	req.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 400 {
		t.Fatal("cross origin accepted", response.StatusCode)
	}
	payload["key"] = ""
	h.do("PUT", "/api/studio/settings", payload)
	cfg, _ = h.srv.readStudioSettings()
	if cfg.Key != "" {
		t.Fatal("explicit key removal failed")
	}
}
func TestStudioImageGenerationAndReference(t *testing.T) {
	h := start(t)
	imageBytes := paletteImage(t, []color.NRGBA{{20, 100, 130, 255}})
	calls := make(chan string, 2)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fake-key" {
			t.Error("missing credential")
		}
		if r.URL.Path == "/images/edits" {
			if err := r.ParseMultipartForm(24 << 20); err != nil {
				t.Error(err)
			}
			if len(r.MultipartForm.File["image"]) != 1 {
				t.Error("reference attachment lost")
			}
		} else {
			var input map[string]any
			json.NewDecoder(r.Body).Decode(&input)
			if !strings.Contains(input["prompt"].(string), "20.000 cm") {
				t.Error("physical dimensions missing")
			}
		}
		calls <- r.URL.Path
		json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(imageBytes)}}})
	}))
	defer provider.Close()
	h.do("PUT", "/api/studio/settings", map[string]any{"key": "fake-key", "endpoint": provider.URL, "imageModel": "test-image", "layoutModel": "test-layout"})
	asset, err := h.srv.assets.SaveBytes(imageBytes, "png")
	if err != nil {
		t.Fatal(err)
	}
	for _, references := range [][]string{nil, {"/assets/" + asset.SHA + ".png"}} {
		code, b := h.do("POST", "/api/studio/generate", map[string]any{"prompt": "storybook scene", "widthCm": 20, "heightCm": 28, "references": references})
		if code != 202 {
			t.Fatal(code, string(b))
		}
		var job studioJob
		json.Unmarshal(b, &job)
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			_, b = h.do("GET", "/api/studio/jobs/"+job.ID, nil)
			json.Unmarshal(b, &job)
			if job.Status != "running" {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if job.Status != "done" || job.URL == "" || job.PixelWidth != 100 {
			t.Fatal(string(b))
		}
	}
	if <-calls != "/images/generations" || <-calls != "/images/edits" {
		t.Fatal("wrong API routes")
	}
}

func TestStudioLayeredPosterKeepsTextNative(t *testing.T) {
	h := start(t)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/responses" {
			t.Error("unexpected image request")
			http.Error(w, "unexpected", 400)
			return
		}
		plan := `{"background":"#f6edd5","elements":[{"kind":"shape","name":"异形底板","shape":"ellipse","xCm":2,"yCm":4,"widthCm":40,"heightCm":30,"fill":"#267d80"},{"kind":"text","name":"文明标题","text":"文明润童心","xCm":10,"yCm":10,"widthCm":120,"heightCm":20,"fontSizeCm":8,"fill":"#123d40"}]}`
		json.NewEncoder(w).Encode(map[string]any{"output": []any{map[string]any{"content": []any{map[string]string{"type": "output_text", "text": plan}}}}})
	}))
	defer provider.Close()
	h.do("PUT", "/api/studio/settings", map[string]any{"key": "fake-key", "endpoint": provider.URL, "imageModel": "test-image", "layoutModel": "test-layout"})
	code, b := h.do("POST", "/api/studio/generate", map[string]any{"mode": "poster", "prompt": "一年级文明黑板报", "widthCm": 400, "heightCm": 104, "unitsPerCm": 20})
	if code != 202 {
		t.Fatal(code, string(b))
	}
	var job studioJob
	json.Unmarshal(b, &job)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_, b = h.do("GET", "/api/studio/jobs/"+job.ID, nil)
		json.Unmarshal(b, &job)
		if job.Status != "running" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if job.Status != "done" || len(job.Commands) != 3 || job.Commands[2]["type"] != "addText" || job.Commands[2]["text"] != "文明润童心" {
		t.Fatal(string(b))
	}
	project := h.project("分层方案")
	commands := []map[string]any{{"type": "addBoard", "name": "生成方案"}, {"type": "setPhysicalCanvas", "widthCm": 400, "heightCm": 104}}
	commands = append(commands, job.Commands...)
	code, b = h.do("POST", "/api/projects/"+project+"/commands", commands)
	if code != 200 || !bytes.Contains(b, []byte(`"ok":true`)) {
		t.Fatal(code, string(b))
	}
	e, _ := h.srv.engine(project)
	p, err := doc.Parse(e.Snapshot())
	if err != nil {
		t.Fatal(err)
	}
	board := p.ActiveBoard()
	if board.Canvas.Physical.WidthCm != 400 || len(board.Layers) != 2 || board.Layers[1].Type != "text" || len(p.Boards) != 2 {
		t.Fatal("layered poster import did not preserve native layers")
	}
}

func TestStudioReferenceTypographyRemainsEditable(t *testing.T) {
	h := start(t)
	fonts := h.srv.fontList()
	if len(fonts) == 0 {
		t.Fatal("no fonts")
	}
	family := ""
	for _, f := range fonts {
		if !f.Hidden {
			family = f.Family
			break
		}
	}
	if family == "" {
		t.Fatal("no visible fonts")
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]any
		json.NewDecoder(r.Body).Decode(&input)
		if r.URL.Path != "/responses" {
			t.Error("typography must not create a flattened image")
		}
		text, _ := json.Marshal(map[string]any{"fontFamily": family, "fontSizeCm": 2, "fontWeight": 700, "fill": "#123d40", "strokeColor": "#fff8e8", "strokeWidthCm": 0.05, "letterSpacingCm": 0.1, "skew": 5})
		json.NewEncoder(w).Encode(map[string]any{"output": []any{map[string]any{"content": []any{map[string]string{"type": "output_text", "text": string(text)}}}}})
	}))
	defer provider.Close()
	cfg := studioSettings{Key: "fake-key", Endpoint: provider.URL, ImageModel: "unused", LayoutModel: "test-layout"}
	commands, err := h.srv.generateStudioTextStyle(context.Background(), cfg, generateRequest{TargetID: "heading", TargetSignature: `{"text":"文明润童心","type":"text"}`, Prompt: "参考附件的书法风格", WidthCm: 40, HeightCm: 8, UnitsPerCm: 20}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(commands) != 1 || commands[0]["type"] != "setTextStyle" || commands[0]["id"] != "heading" {
		t.Fatal(commands)
	}
	if _, changed := commands[0]["text"]; changed {
		t.Fatal("style matching must not change original text")
	}
	style := commands[0]["style"].(map[string]any)
	if style["fontSize"] != float64(40) || style["stroke"] != "#fff8e8:1" {
		t.Fatal(style)
	}
}
