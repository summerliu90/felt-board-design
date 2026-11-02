package server

import (
	"bytes"
	"errors"
	"image"
	"image/draw"
	"image/png"
	"math"
)

// fitStudioImage changes only the transparent canvas. Original pixels are never
// stretched, cropped or downsampled to accommodate a physical aspect ratio.
func fitStudioImage(raw []byte, widthCm, heightCm float64) ([]byte, int, int, error) {
	config, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, 0, 0, errors.New("图片格式无效")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > 16000 || config.Height > 16000 || config.Width*config.Height > 64_000_000 {
		return nil, 0, 0, errors.New("图片像素尺寸过大")
	}
	if widthCm <= 0 || heightCm <= 0 || math.IsNaN(widthCm) || math.IsNaN(heightCm) || math.IsInf(widthCm, 0) || math.IsInf(heightCm, 0) {
		return nil, 0, 0, errors.New("成品尺寸无效")
	}
	width, height := config.Width, config.Height
	ratio := widthCm / heightCm
	if float64(width)/float64(height) < ratio {
		width = int(math.Ceil(float64(height) * ratio))
	} else {
		height = int(math.Ceil(float64(width) / ratio))
	}
	if width > 16000 || height > 16000 || width*height > 64_000_000 {
		return nil, 0, 0, errors.New("此长宽比例需要过大透明画布，请将素材拆为多件")
	}
	if width == config.Width && height == config.Height {
		return raw, width, height, nil
	}
	original, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, 0, 0, err
	}
	var canvas draw.Image = image.NewNRGBA(image.Rect(0, 0, width, height))
	switch original.(type) {
	case *image.NRGBA64, *image.RGBA64, *image.Gray16:
		canvas = image.NewNRGBA64(image.Rect(0, 0, width, height))
	}
	offset := image.Pt((width-config.Width)/2, (height-config.Height)/2)
	draw.Draw(canvas, image.Rectangle{Min: offset, Max: offset.Add(original.Bounds().Size())}, original, original.Bounds().Min, draw.Src)
	var output bytes.Buffer
	if err := png.Encode(&output, canvas); err != nil {
		return nil, 0, 0, err
	}
	return output.Bytes(), width, height, nil
}
