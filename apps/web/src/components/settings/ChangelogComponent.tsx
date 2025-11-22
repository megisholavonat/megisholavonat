import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChangelogComponentProps {
    content: string;
}

export default function ChangelogComponent({
    content,
}: ChangelogComponentProps) {
    return (
        <div className="mt-5 prose prose-slate dark:prose-invert max-w-none">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </div>
    );
}
