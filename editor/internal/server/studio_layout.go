package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"
)

type layoutElement struct {
	Kind     string  `json:"kind"`
	Name     string  `json:"name"`
	Text     string  `json:"text"`
	Prompt   string  `json:"prompt"`
	Shape    string  `json:"shape"`
	X        float64 `json:"xCm"`
	Y        float64 `json:"yCm"`
	Width    float64 `json:"widthCm"`
	Height   float64 `json:"heightCm"`
	FontSize float64 `json:"fontSizeCm"`
	Fill     string  `json:"fill"`
}
type layoutPlan struct {
	Background string          `json:"background"`
	Elements   []layoutElement `json:"elements"`
}

var studioColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (s *Server) generateStudioLayout(ctx context.Context, cfg studioSettings, req generateRequest, refs [][]byte) ([]map[string]any, error) {
	instruction := fmt.Sprintf(`Return JSON only. Design a polished layered poster for a physical %.3f by %.3f centimeter board. User brief: %s
Study reference images for drawing style, typography, irregular cards, colors and composition. Use an individualized storybook composition with varied silhouettes and rich useful content. Do not default to four equal rectangles. Make every heading and body paragraph a separate text element, and every illustration, decorative element and card background separate. Exact Chinese text, suitable for the stated age. Avoid tiny cutout details. Coordinate origin top-left in centimeters. Everything must fit the board. Return {"background":"#hexcolor","elements":[{"kind":"text|image|shape","name":"semantic Chinese name","text":"exact text for text elements","prompt":"self-contained detailed illustration prompt for image elements, explicitly no text","shape":"rect|ellipse|triangle","xCm":0,"yCm":0,"widthCm":10,"heightCm":10,"fontSizeCm":2,"fill":"#hexcolor"}]}. Put background shapes first, images next, text on top. Up to 60 elements and at most 6 image elements. Irregular decorative boards can be image elements with detailed easy-cut silhouettes. All text MUST remain native editable text, never in an illustration. JSON only.`, req.WidthCm, req.HeightCm, req.Prompt)
	text, err := studioJSON(ctx, cfg, instruction, refs)
	if err != nil {
		return nil, err
	}
	var plan layoutPlan
	if err = json.Unmarshal([]byte(text), &plan); err != nil {
		return nil, errors.New("排版模型未返回有效 JSON 设计")
	}
	if err = validateStudioLayout(plan, req.WidthCm, req.HeightCm); err != nil {
		return nil, err
	}
	units := req.UnitsPerCm
	if units <= 0 {
		units = 20
	}
	commands := []map[string]any{{"type": "setBackground", "color": plan.Background}}
	for _, element := range plan.Elements {
		command := map[string]any{"name": element.Name, "x": element.X * units, "y": element.Y * units, "width": element.Width * units, "height": element.Height * units}
		switch element.Kind {
		case "text":
			delete(command, "height")
			command["type"] = "addText"
			command["text"] = element.Text
			command["style"] = map[string]any{"fontFamily": "PingFang SC", "fontSize": element.FontSize * units, "fill": element.Fill, "lineHeight": 1.25}
		case "shape":
			command["type"] = "addShape"
			command["kind"] = element.Shape
			command["fill"] = element.Fill
		case "image":
			imageRequest := generateRequest{Prompt: element.Prompt + ". No writing, no letters, no text. Match the supplied reference style. Keep a simple outer silhouette suitable for scissors.", WidthCm: element.Width, HeightCm: element.Height}
			asset, _, _, err := s.generateStudioImage(ctx, cfg, imageRequest, refs)
			if err != nil {
				return nil, err
			}
			command["type"] = "addImage"
			command["url"] = asset
		}
		commands = append(commands, command)
	}
	return commands, nil
}
func validateStudioLayout(plan layoutPlan, width, height float64) error {
	if !studioColor.MatchString(plan.Background) || len(plan.Elements) == 0 || len(plan.Elements) > 60 {
		return errors.New("排版方案的颜色或元素数量无效")
	}
	images := 0
	for _, e := range plan.Elements {
		for _, v := range []float64{e.X, e.Y, e.Width, e.Height, e.FontSize} {
			if math.IsInf(v, 0) || math.IsNaN(v) {
				return errors.New("排版方案含无效数值")
			}
		}
		if strings.TrimSpace(e.Name) == "" || e.X < 0 || e.Y < 0 || e.Width <= 0 || e.Height <= 0 || e.X+e.Width > width+0.001 || e.Y+e.Height > height+0.001 {
			return errors.New("排版素材超出画布或缺少有效尺寸，请调整描述重试")
		}
		switch e.Kind {
		case "text":
			if e.Text == "" || e.FontSize <= 0 || !studioColor.MatchString(e.Fill) {
				return errors.New("文字方案不完整")
			}
		case "image":
			images++
			if e.Prompt == "" || images > 6 {
				return errors.New("插画方案不完整或超过6张")
			}
		case "shape":
			if !studioColor.MatchString(e.Fill) || (e.Shape != "rect" && e.Shape != "ellipse" && e.Shape != "triangle") {
				return errors.New("底板方案不完整")
			}
		default:
			return errors.New("不支持的设计元素")
		}
	}
	return nil
}

func studioJSON(ctx context.Context, cfg studioSettings, instruction string, refs [][]byte) (string, error) {
	content := []map[string]any{{"type": "input_text", "text": instruction}}
	for _, ref := range refs {
		content = append(content, map[string]any{"type": "input_image", "image_url": "data:image/png;base64," + base64.StdEncoding.EncodeToString(ref)})
	}
	payload, _ := json.Marshal(map[string]any{"model": cfg.LayoutModel, "input": []any{map[string]any{"role": "user", "content": content}}, "text": map[string]any{"format": map[string]any{"type": "json_object"}}})
	request, err := http.NewRequestWithContext(ctx, "POST", cfg.Endpoint+"/responses", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+cfg.Key)
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{CheckRedirect: func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return "", errors.New("排版服务连接失败或超时")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", fmt.Errorf("排版服务返回 HTTP %d，请检查排版模型权限", response.StatusCode)
	}
	var result struct {
		Output []struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&result); err != nil {
		return "", errors.New("无法读取排版方案")
	}
	text := ""
	for _, output := range result.Output {
		for _, c := range output.Content {
			if c.Type == "output_text" {
				text += c.Text
			}
		}
	}

	return text, nil
}
