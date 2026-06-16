import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Render Claude's markdown output (headings, lists, tables, code, links) as formatted HTML. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Open links in a new tab.
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
