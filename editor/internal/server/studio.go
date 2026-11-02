package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

type studioSettings struct {
	Key         string `json:"key"`
	Endpoint    string `json:"endpoint"`
	ImageModel  string `json:"imageModel"`
	LayoutModel string `json:"layoutModel"`
}
type studioJob struct {
	Commands        []map[string]any `json:"commands,omitempty"`
	WidthCm         float64          `json:"widthCm"`
	HeightCm        float64          `json:"heightCm"`
	Mode            string           `json:"mode"`
	UnitsPerCm      float64          `json:"unitsPerCm"`
	Prompt          string           `json:"prompt"`
	TargetID        string           `json:"targetId,omitempty"`
	TargetSignature string           `json:"targetSignature,omitempty"`
	BoardID         string           `json:"boardId"`
	ID              string           `json:"id"`
	Status          string           `json:"status"`
	Error           string           `json:"error,omitempty"`
	URL             string           `json:"url,omitempty"`
	PixelWidth      int              `json:"pixelWidth,omitempty"`
	PixelHeight     int              `json:"pixelHeight,omitempty"`
	cancel          context.CancelFunc
}
type studioState struct {
	sync.Mutex
	jobs map[string]*studioJob
}

var studios sync.Map

func (s *Server) studio() *studioState {
	state, _ := studios.LoadOrStore(s.dataDir, &studioState{jobs: map[string]*studioJob{}})
	return state.(*studioState)
}
func (s *Server) readStudioSettings() (studioSettings, error) {
	out := studioSettings{}
	b, err := os.ReadFile(filepath.Join(s.dataDir, "studio-settings.json"))
	if os.IsNotExist(err) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(b, &out)
	return out, err
}

// Secret-bearing operations are limited to the editor origin, despite the public CLI API's CORS.
func studioOrigin(c echo.Context) error {
	origin := c.Request().Header.Get("Origin")
	if origin == "" {
		return nil
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host != c.Request().Host {
		return errors.New("请从本机编辑器打开系统设置和生成面板")
	}
	return nil
}
func (s *Server) registerStudio(api *echo.Group) {
	api.GET("/studio/settings", s.handleStudioSettings)
	api.PUT("/studio/settings", s.handleStudioSettings)
	api.POST("/studio/generate", s.handleStudioGenerate)
	api.GET("/studio/jobs/:job", s.handleStudioJob)
	api.DELETE("/studio/jobs/:job", s.handleStudioJob)
	api.POST("/studio/import-latest-codex", s.handleImportLatestCodex)

}

// handleImportLatestCodex makes the newest local Codex image available as a
// normal DaVinci asset. It is intentionally read-only outside the configured
// Codex output directory and never executes generated content.
func (s *Server) handleImportLatestCodex(c echo.Context) error {
	if err := studioOrigin(c); err != nil { return badRequest(c, err.Error()) }
	home, err := os.UserHomeDir(); if err != nil { return badRequest(c, "无法定位用户目录") }
	root := filepath.Join(home, ".codex", "generated_images")
	var newest string; var newestTime time.Time
	err = filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil || info == nil || info.IsDir() { return nil }
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".png" && ext != ".jpg" && ext != ".jpeg" && ext != ".webp" { return nil }
		if info.ModTime().After(newestTime) { newest, newestTime = path, info.ModTime() }
		return nil
	})
	if err != nil || newest == "" { return badRequest(c, "没有找到 Codex 生成图片") }
	b, err := os.ReadFile(newest); if err != nil { return badRequest(c, "无法读取最近生成图片") }
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(newest)), "."); if ext == "" { ext = "png" }
	asset, err := s.assets.SaveBytes(b, ext); if err != nil { return badRequest(c, "无法导入生成图片") }
	return c.JSON(http.StatusOK, map[string]any{"url": "/assets/" + asset.SHA + "." + asset.Ext, "name": filepath.Base(newest), "source": newest})
}
func (s *Server) handleStudioSettings(c echo.Context) error {
	if err := studioOrigin(c); err != nil {
		return badRequest(c, err.Error())
	}
	state := s.studio()
	state.Lock()
	defer state.Unlock()
	cfg, err := s.readStudioSettings()
	if err != nil {
		return errJSON(c, err)
	}
	if c.Request().Method == http.MethodPut {
		var req struct {
			Key         *string `json:"key"`
			Endpoint    string  `json:"endpoint"`
			ImageModel  string  `json:"imageModel"`
			LayoutModel string  `json:"layoutModel"`
		}
		c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 16<<10)
		if err := c.Bind(&req); err != nil {
			return badRequest(c, "无效的设置")
		}
		u, err := url.Parse(req.Endpoint)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"))) {
			return badRequest(c, "API 地址需为 HTTPS，或本机 HTTP 调试地址")
		}
		if strings.TrimSpace(req.ImageModel) == "" || strings.TrimSpace(req.LayoutModel) == "" {
			return badRequest(c, "请填写图片模型与排版模型")
		}
		if req.Key != nil {
			cfg.Key = strings.TrimSpace(*req.Key)
		}
		cfg.Endpoint = strings.TrimRight(req.Endpoint, "/")
		cfg.ImageModel = req.ImageModel
		cfg.LayoutModel = req.LayoutModel
		b, _ := json.Marshal(cfg)
		f, err := os.CreateTemp(s.dataDir, ".studio-settings-*")
		if err != nil {
			return errJSON(c, err)
		}
		tmp := f.Name()
		defer os.Remove(tmp)
		if err = f.Chmod(0600); err == nil {
			_, err = f.Write(b)
		}
		closeErr := f.Close()
		if err == nil {
			err = closeErr
		}
		if err == nil {
			err = os.Rename(tmp, filepath.Join(s.dataDir, "studio-settings.json"))
		}
		if err != nil {
			return errJSON(c, err)
		}
	}
	return c.JSON(200, map[string]any{"configured": cfg.Key != "", "endpoint": cfg.Endpoint, "imageModel": cfg.ImageModel, "layoutModel": cfg.LayoutModel})
}

type generateRequest struct {
	Mode            string   `json:"mode"`
	TargetID        string   `json:"targetId"`
	TargetSignature string   `json:"targetSignature"`
	BoardID         string   `json:"boardId"`
	UnitsPerCm      float64  `json:"unitsPerCm"`
	Prompt          string   `json:"prompt"`
	WidthCm         float64  `json:"widthCm"`
	HeightCm        float64  `json:"heightCm"`
	References      []string `json:"references"`
}

func (s *Server) handleStudioGenerate(c echo.Context) error {
	if err := studioOrigin(c); err != nil {
		return badRequest(c, err.Error())
	}
	var req generateRequest
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 64<<10)
	if err := c.Bind(&req); err != nil {
		return badRequest(c, "无效的生成请求")
	}
	if strings.TrimSpace(req.Prompt) == "" || len(req.Prompt) > 20000 || req.WidthCm <= 0 || req.HeightCm <= 0 || req.WidthCm > 1000 || req.HeightCm > 1000 || len(req.References) > 8 {
		return badRequest(c, "请输入描述、有效厘米尺寸和最多8张参考图")
	}
	if req.Mode != "" && req.Mode != "asset" && req.Mode != "poster" && req.Mode != "textstyle" {
		return badRequest(c, "未知生成方式")
	}
	if req.UnitsPerCm == 0 {
		req.UnitsPerCm = 20
	}
	if req.UnitsPerCm <= 0 || req.UnitsPerCm > 1000 {
		return badRequest(c, "厘米比例无效")
	}
	cfg, err := s.readStudioSettings()
	if err != nil {
		return errJSON(c, err)
	}
	if cfg.Key == "" {
		return badRequest(c, "请先在系统设置中配置 API Key")
	}
	refs := [][]byte{}
	for _, ref := range req.References {
		if !strings.HasPrefix(ref, "/assets/") || filepath.Base(ref) != strings.TrimPrefix(ref, "/assets/") {
			return badRequest(c, "参考图必须为已上传的本机素材")
		}
		b, err := os.ReadFile(filepath.Join(s.dataDir, "assets", filepath.Base(ref)))
		if err != nil {
			return badRequest(c, "参考素材不存在")
		}
		if len(b) > 20<<20 {
			return badRequest(c, "单张参考图不得超过20MB")
		}
		if _, _, err := image.DecodeConfig(bytes.NewReader(b)); err != nil {
			return badRequest(c, "参考附件需为 PNG 或 JPEG 图片")
		}
		refs = append(refs, b)
	}
	state := s.studio()
	state.Lock()
	running := 0
	for _, j := range state.jobs {
		if j.Status == "running" {
			running++
		}
	}
	if running >= 2 {
		state.Unlock()
		return badRequest(c, "已有两项生成任务，请稍后重试")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	job := &studioJob{BoardID: req.BoardID, Mode: req.Mode, UnitsPerCm: req.UnitsPerCm, Prompt: req.Prompt, TargetID: req.TargetID, TargetSignature: req.TargetSignature, WidthCm: req.WidthCm, HeightCm: req.HeightCm, ID: fmt.Sprintf("gen_%d", time.Now().UnixNano()), Status: "running", cancel: cancel}
	state.jobs[job.ID] = job
	state.Unlock()
	go func() {
		defer cancel()
		if req.Mode == "poster" || req.Mode == "textstyle" {
			var commands []map[string]any
			var err error
			if req.Mode == "textstyle" {
				commands, err = s.generateStudioTextStyle(ctx, cfg, req, refs)
			} else {
				commands, err = s.generateStudioLayout(ctx, cfg, req, refs)
			}
			state.Lock()
			defer state.Unlock()
			if job.Status == "cancelled" {
				return
			}
			if err != nil {
				job.Status = "failed"
				job.Error = err.Error()
			} else {
				job.Status = "done"
				job.Commands = commands
			}
			return
		}
		asset, w, h, err := s.generateStudioImage(ctx, cfg, req, refs)
		state.Lock()
		defer state.Unlock()
		if job.Status == "cancelled" {
			return
		}
		if err != nil {
			job.Status = "failed"
			job.Error = err.Error()
			return
		}
		job.Status = "done"
		job.URL = asset
		job.PixelWidth = w
		job.PixelHeight = h
	}()
	return c.JSON(http.StatusAccepted, map[string]any{"id": job.ID, "status": "running"})
}
func (s *Server) handleStudioJob(c echo.Context) error {
	if err := studioOrigin(c); err != nil {
		return badRequest(c, err.Error())
	}
	state := s.studio()
	state.Lock()
	defer state.Unlock()
	job := state.jobs[c.Param("job")]
	if job == nil {
		return c.JSON(404, map[string]any{"error": "生成任务不存在或服务已重新启动"})
	}
	if c.Request().Method == http.MethodDelete && job.Status == "running" {
		job.cancel()
		job.Status = "cancelled"
	}
	return c.JSON(200, job)
}
func (s *Server) generateStudioImage(ctx context.Context, cfg studioSettings, req generateRequest, refs [][]byte) (string, int, int, error) {
	prompt := fmt.Sprintf("%s\nDesign target: %.3f cm wide × %.3f cm high. Compose for this aspect ratio. Keep all content inside the frame. Reference attachments convey the requested style or shape; follow the user's description.", req.Prompt, req.WidthCm, req.HeightCm)
	size := "1024x1024"
	if req.WidthCm/req.HeightCm > 1.2 {
		size = "1536x1024"
	} else if req.HeightCm/req.WidthCm > 1.2 {
		size = "1024x1536"
	}
	var body io.Reader
	contentType := "application/json"
	endpoint := "/images/generations"
	if len(refs) == 0 {
		b, _ := json.Marshal(map[string]any{"model": cfg.ImageModel, "prompt": prompt, "size": size, "quality": "high", "output_format": "png", "n": 1})
		body = bytes.NewReader(b)
	} else {
		var b bytes.Buffer
		writer := multipart.NewWriter(&b)
		for k, v := range map[string]string{"model": cfg.ImageModel, "prompt": prompt, "size": size, "quality": "high", "output_format": "png"} {
			_ = writer.WriteField(k, v)
		}
		// Match the working gzh_to_video edit client: the OpenAI-compatible
		// gateway expects a singular `image` field. Use the first reference as
		// the edit source; remaining attachments are still included in the prompt
		// context by the UI and can be used in a subsequent edit.
		for i, ref := range refs[:1] {
			part, err := writer.CreateFormFile("image", fmt.Sprintf("reference-%d.png", i))
			if err != nil {
				return "", 0, 0, err
			}
			_, _ = part.Write(ref)
		}
		_ = writer.Close()
		body = &b
		contentType = writer.FormDataContentType()
		endpoint = "/images/edits"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.Endpoint+endpoint, body)
	if err != nil {
		return "", 0, 0, err
	}
	request.Header.Set("Authorization", "Bearer "+cfg.Key)
	request.Header.Set("Content-Type", contentType)
	client := &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return "", 0, 0, errors.New("图片服务连接失败或任务超时，请检查网络及 API 地址")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", 0, 0, fmt.Errorf("图片服务返回 HTTP %d；请检查模型权限、Key 和账户额度", response.StatusCode)
	}
	var out struct {
		Data []struct {
			B64 string `json:"b64_json"`
		} `json:"data"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 128<<20)).Decode(&out); err != nil {
		return "", 0, 0, errors.New("图片服务返回无法读取的数据")
	}
	if len(out.Data) == 0 {
		return "", 0, 0, errors.New("图片服务未返回图片")
	}
	b, err := base64.StdEncoding.DecodeString(out.Data[0].B64)
	if err != nil {
		return "", 0, 0, errors.New("图片数据解码失败")
	}
	_, _, err = image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return "", 0, 0, errors.New("图片服务返回的文件不是有效图片")
	}
	// Keep the exact provider original as an independently addressable asset.
	if _, err = s.assets.SaveBytes(b, "png"); err != nil {
		return "", 0, 0, err
	}
	b, width, height, err := fitStudioImage(b, req.WidthCm, req.HeightCm)
	if err != nil {
		return "", 0, 0, err
	}
	asset, err := s.assets.SaveBytes(b, "png")
	if err != nil {
		return "", 0, 0, err
	}
	return "/assets/" + asset.SHA + ".png", width, height, nil
}
