import type { ReactNode } from 'react';

type ProfileFieldItem = {
  key: string;
  label: string;
  className: string;
  control: ReactNode;
};

type CollaboratorDetailsProfileSectionProps = {
  title: string;
  description: string;
  sectionClassName?: string;
  fields: ProfileFieldItem[];
};

export default function CollaboratorDetailsProfileSection({
  title,
  description,
  sectionClassName,
  fields,
}: CollaboratorDetailsProfileSectionProps) {
  return (
    <article className={`cm-section ${sectionClassName ?? ''}`.trim()}>
      <div className="cm-section-head">
        <div>
          <h5 className="cm-section-title">{title}</h5>
          <p>{description}</p>
        </div>
      </div>
      <div className="collaborator-edit-grid">
        {fields.map((field) => (
          <label key={field.key} className={field.className}>
            <span>{field.label}</span>
            {field.control}
          </label>
        ))}
      </div>
    </article>
  );
}
