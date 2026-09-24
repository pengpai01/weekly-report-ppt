import type { FilledSlide } from "../lib/templateSlides";

/** Paints one slide from the filled official template. Not a separate layout. */
export function TemplateSlideView({ slide }: { slide: FilledSlide }) {
  return (
    <div className="tpl-slide" data-slide-source="templates/week-summary-template.pptx">
      {slide.shapes.map((shape, index) => (
        <div
          key={index}
          className={shape.line ? "tpl-line" : shape.paragraphs?.length ? "tpl-shape tpl-text-shape" : "tpl-shape"}
          style={{
            left: shape.x,
            top: shape.y,
            width: shape.w,
            height: shape.line ? 3 : shape.h,
            background: shape.fill,
            borderTop: shape.line ? `3px solid ${shape.line}` : undefined,
          }}
        >
          {shape.src ? <img alt="" draggable={false} src={shape.src} /> : null}
          {shape.paragraphs?.length ? (
            <div className="tpl-text">
              {shape.paragraphs.map((paragraph, paragraphIndex) => (
                <p
                  key={paragraphIndex}
                  style={{
                    textAlign: paragraph.align,
                    fontSize: paragraph.fontSize,
                    fontWeight: paragraph.bold ? 700 : 400,
                    color: paragraph.color,
                    paddingLeft: paragraph.level * 28,
                  }}
                >
                  {paragraph.bullet ? "• " : ""}
                  {paragraph.text}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
