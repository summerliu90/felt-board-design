package doc

import "testing"

func TestPhysicalCanvasPersistenceAndHistory(t *testing.T) {
	e, _ := engine(t)
	run(t, e, `{"type":"setPhysicalCanvas","widthCm":400,"heightCm":104}`)
	b := e.p.ActiveBoard()
	if b.Canvas.Width != 8000 || b.Canvas.Height != 2080 || b.Canvas.Physical.WidthCm != 400 {
		t.Fatal(b.Canvas)
	}
	p, err := Parse(e.Snapshot())
	if err != nil {
		t.Fatal(err)
	}
	if p.ActiveBoard().Canvas.Physical.UnitsPerCm != 20 {
		t.Fatal("physical scale lost on save")
	}
	run(t, e, `{"type":"setCanvasSize","width":6000,"height":2080}`)
	if e.p.ActiveBoard().Canvas.Physical.WidthCm != 300 {
		t.Fatal("pixel resize desynchronized physical dimensions")
	}
	run(t, e, `{"type":"undo"}`)
	if e.p.ActiveBoard().Canvas.Physical.WidthCm != 400 {
		t.Fatal("undo lost physical dimensions")
	}
	for _, cmd := range []string{`{"type":"setPhysicalCanvas","widthCm":-1,"heightCm":104}`, `{"type":"setPhysicalCanvas","widthCm":40000,"heightCm":104}`} {
		if e.Apply([]byte(cmd)).OK {
			t.Fatal("invalid physical geometry accepted")
		}
	}
}
