package server

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestStudioPhysicalPaddingNeverResamples(t *testing.T) {
	original := image.NewNRGBA(image.Rect(0, 0, 4, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			original.SetNRGBA(x, y, color.NRGBA{uint8(x * 60), uint8(y * 120), 80, uint8(100 + x*30)})
		}
	}
	var buffer bytes.Buffer
	png.Encode(&buffer, original)
	raw, w, h, err := fitStudioImage(buffer.Bytes(), 20, 20)
	if err != nil || w != 4 || h != 4 {
		t.Fatal(w, h, err)
	}
	result, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			if result.At(x, y+1) != original.At(x, y) {
				t.Fatal("source pixel changed", x, y, result.At(x, y+1), original.At(x, y))
			}
		}
	}
	if _, _, _, a := result.At(0, 0).RGBA(); a != 0 {
		t.Fatal("padding must be transparent")
	}
	unchanged, w, h, err := fitStudioImage(buffer.Bytes(), 40, 20)
	if err != nil || w != 4 || h != 2 || !bytes.Equal(unchanged, buffer.Bytes()) {
		t.Fatal("matching aspect must keep original bytes")
	}
	if _, _, _, err := fitStudioImage(buffer.Bytes(), 1000, .001); err == nil {
		t.Fatal("unbounded transparent allocation accepted")
	}
}
