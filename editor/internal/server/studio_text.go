package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

// Style matching chooses an installed font and native styles; it never flattens
// the user's original text into an image or changes the user's text content.
func (s *Server) generateStudioTextStyle(ctx context.Context, cfg studioSettings, req generateRequest, refs [][]byte) ([]map[string]any, error) {
	if req.TargetID == "" || req.TargetSignature == "" {
		return nil, errors.New("请先选中原生文字图层")
	}
	fonts := s.fontList()
	families := []string{}
	allowed := map[string]bool{}
	for _, f := range fonts {
		if !f.Hidden {
			families = append(families, f.Family)
			allowed[f.Family] = true
		}
	}
	instruction := fmt.Sprintf(`Return JSON only. Match the typography style in the reference images to this editable Chinese text layer, using an installed font from this list: %v. User request: %s. Original layer JSON: %s. This box is %.3f cm wide and %.3f cm high. Choose the closest available font; do not pretend an exact font is available if it is not. Keep all text content and position unchanged. Return {"fontFamily":"installed family","fontSizeCm":2,"fontWeight":700,"fill":"#123456","strokeColor":"#ffffff","strokeWidthCm":0.04,"letterSpacingCm":0,"skew":0}. strokeWidthCm can be 0; letterSpacingCm between -1 and 3; skew between -30 and 30. Only approximate visual style with editable properties. JSON only.`, families, req.Prompt, req.TargetSignature, req.WidthCm, req.HeightCm)
	raw, err := studioJSON(ctx, cfg, instruction, refs)
	if err != nil {
		return nil, err
	}
	var style struct {
		FontFamily  string  `json:"fontFamily"`
		FontSize    float64 `json:"fontSizeCm"`
		Weight      int     `json:"fontWeight"`
		Fill        string  `json:"fill"`
		StrokeColor string  `json:"strokeColor"`
		StrokeWidth float64 `json:"strokeWidthCm"`
		Spacing     float64 `json:"letterSpacingCm"`
		Skew        float64 `json:"skew"`
	}
	if err = json.Unmarshal([]byte(raw), &style); err != nil {
		return nil, errors.New("参考图样式分析未返回有效 JSON")
	}
	for _, value := range []float64{style.FontSize, style.StrokeWidth, style.Spacing, style.Skew} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, errors.New("文字样式包含无效数字")
		}
	}
	if !allowed[style.FontFamily] || !studioColor.MatchString(style.Fill) || style.FontSize <= 0 || style.FontSize > req.HeightCm || style.Weight < 100 || style.Weight > 900 || style.StrokeWidth < 0 || style.StrokeWidth > 1 || style.Spacing < -1 || style.Spacing > 3 || style.Skew < -30 || style.Skew > 30 {
		return nil, errors.New("参考图样式不适合当前文字框，或字体未安装，请调整描述重试")
	}
	units := req.UnitsPerCm
	if units <= 0 {
		units = 20
	}
	stroke := ""
	if style.StrokeWidth > 0 {
		if !studioColor.MatchString(style.StrokeColor) {
			return nil, errors.New("描边颜色无效")
		}
		stroke = fmt.Sprintf("%s:%g", style.StrokeColor, style.StrokeWidth*units)
	}
	return []map[string]any{{"type": "setTextStyle", "id": req.TargetID, "style": map[string]any{"fontFamily": style.FontFamily, "fontSize": style.FontSize * units, "fontWeight": style.Weight, "fill": style.Fill, "stroke": stroke, "letterSpacing": style.Spacing * units, "skew": style.Skew}}}, nil
}
