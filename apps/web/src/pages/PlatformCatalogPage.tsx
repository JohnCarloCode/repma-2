import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { createCategoryBody, type Category, type Page } from 'shared';
import { FormField } from '../components/FormField';
import { FormModal } from '../components/Modal';
import { primaryButtonClass } from '../components/buttons';
import { textAreaClass, textInputClass } from '../components/form';
import { DataTable, RowAction, type Column } from '../components/list/DataTable';
import { PageHeader } from '../components/list/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/list/states';
import { ApiError, api } from '../lib/apiClient';
import { useToast } from '../lib/toast';
import { ProductCreateModal, ProductsTab } from './PlatformProductsTab';

/**
 * Every categories query shares this prefix — this tab's list and the store-side filter/picker
 * options read the very same `['categories', { pageSize: 100 }]` — so one invalidation after a
 * write refreshes them all (platform-catalog.md §Create / edit category step 2).
 */
const CATEGORIES = ['categories'] as const;
/** Product rows carry `categoryName`: a rename must reach them too. */
const PRODUCTS = ['products'] as const;

type Tab = 'categories' | 'products';

/** A modal whose content outlives `open` so it can animate out. */
type Opened<T> = { value: T; open: boolean; seq: number } | null;

let openings = 0;

/**
 * platform-catalog.md — the Platform Admin's global catalog (RF-13..17): a Categories and a
 * Products tab. Platform zone: global calls, never `X-Tenant-Id`, no store needed. The active tab
 * lives in `?tab=` (absent or unknown = Products, the default), so it is shareable and survives a
 * reload; switching tabs drops the other tab's params.
 */
export function PlatformCatalogPage() {
  const [params] = useSearchParams();
  const tab: Tab = params.get('tab') === 'categories' ? 'categories' : 'products';
  const [creating, setCreating] = useState(false);

  // The header's primary action follows the active tab.
  const action = (
    <button type="button" className={primaryButtonClass} onClick={() => setCreating(true)}>
      {tab === 'categories' ? 'New category' : 'New product'}
    </button>
  );

  return (
    <main className="flex flex-col gap-lg">
      <PageHeader title="Catalog admin" action={action} />
      <nav aria-label="Catalog sections" className="flex items-center gap-xs">
        <TabLink to="/platform/catalog?tab=categories" current={tab === 'categories'} label="Categories" />
        <TabLink to="/platform/catalog" current={tab === 'products'} label="Products" />
      </nav>
      {tab === 'categories' ? (
        <>
          <CategoriesTab onCreate={() => setCreating(true)} />
          <CategoryFormModal open={creating} onClose={() => setCreating(false)} />
        </>
      ) : (
        <>
          <ProductsTab onCreate={() => setCreating(true)} />
          <ProductCreateModal open={creating} onClose={() => setCreating(false)} />
        </>
      )}
    </main>
  );
}

/** A tab is a link: the URL is the state (middle-click / copy work), `aria-current` marks the active one. */
function TabLink({ to, current, label }: { to: string; current: boolean; label: string }) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      className={`flex min-h-[44px] items-center justify-center rounded-sm border px-base text-body-medium transition-colors ${
        current
          ? 'border-accent bg-accent text-on-accent'
          : 'border-border-strong bg-surface text-text hover:bg-surface-raised'
      }`}
    >
      {label}
    </Link>
  );
}

/** Tab "Categories": every category in one unpaginated table (a small closed set) with an Edit row action — no delete (RF-14). */
function CategoriesTab({ onCreate }: { onCreate: () => void }) {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: [...CATEGORIES, { pageSize: 100 }],
    queryFn: () => api.get<Page<Category>>('/categories?pageSize=100'),
  });
  const [editing, setEditing] = useState<Opened<Category>>(null);
  const reorder = useReorderCategories();

  const columns: Column<Category>[] = [
    {
      header: 'Order',
      cell: (c) => {
        const index = data!.items.indexOf(c);
        return (
          <span className="inline-flex">
            <RowAction
              icon="expand_less"
              label={`Move ${c.name} up`}
              disabled={index === 0 || reorder.isPending}
              onClick={() => reorder.move(data!.items, index, index - 1)}
            />
            <RowAction
              icon="expand_more"
              label={`Move ${c.name} down`}
              disabled={index === data!.items.length - 1 || reorder.isPending}
              onClick={() => reorder.move(data!.items, index, index + 1)}
            />
          </span>
        );
      },
    },
    { header: 'Name', cell: (c) => <span className="text-body-medium">{c.name}</span> },
    { header: 'Slug', cell: (c) => <span className="text-caption text-text-secondary">{c.slug}</span> },
    {
      header: 'Description',
      cell: (c) =>
        c.description ? (
          <span className="line-clamp-1 text-text-secondary" title={c.description}>
            {c.description}
          </span>
        ) : (
          <span className="text-text-secondary">—</span>
        ),
    },
    {
      header: '',
      align: 'right',
      cell: (c) => (
        <RowAction icon="edit" label={`Edit ${c.name}`} onClick={() => setEditing({ value: c, open: true, seq: ++openings })} />
      ),
    },
  ];

  return (
    <>
      {isPending ? (
        <LoadingState columns={columns.length} />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon="category" title="No categories yet" action={{ label: 'New category', onClick: onCreate }} />
      ) : (
        <DataTable label="Categories" columns={columns} rows={data.items} rowKey={(c) => c.id} />
      )}
      {editing && (
        <CategoryFormModal
          key={editing.seq}
          category={editing.value}
          open={editing.open}
          onClose={() => setEditing({ ...editing, open: false })}
        />
      )}
    </>
  );
}

/**
 * RF-45 — moves a category one place and saves the whole order (`PUT /categories/order`). The
 * table reorders at once; a failure restores the read order and toasts. Every categories query
 * (store-side filters and picker rail included) is re-read once it settles.
 */
function useReorderCategories() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = [...CATEGORIES, { pageSize: 100 }];
  const mutation = useMutation({
    mutationFn: (ordered: Category[]) => api.put<void>('/categories/order', { ids: ordered.map((c) => c.id) }),
    onMutate: async (ordered) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Page<Category>>(key);
      if (previous) queryClient.setQueryData<Page<Category>>(key, { ...previous, items: ordered });
      return { previous };
    },
    onError: (err, _ordered, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error(err);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CATEGORIES }),
  });
  return {
    isPending: mutation.isPending,
    move: (items: Category[], from: number, to: number) => {
      const ordered = [...items];
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved!);
      mutation.mutate(ordered);
    },
  };
}

type Field = 'name' | 'description';

/**
 * The create ("New category", `POST /categories`) and edit ("Edit category", `PATCH /categories/:id`)
 * form: Name and an optional Description, validated with the shared `createCategoryBody` (its parsed
 * output is the body — trimmed, a blank description becomes null). The slug is the API's (RN-10),
 * shown read-only on edit and never regenerated. 400 details on a field and 409 (an equivalent slug,
 * create only) render inline; anything else is a toast.
 */
function CategoryFormModal({ open, onClose, category }: { open: boolean; onClose: () => void; category?: Category }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const initial = { name: category?.name ?? '', description: category?.description ?? '' };
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  // Validate on submit, then on blur (components.md §Forms).
  const [submitted, setSubmitted] = useState(false);

  const check = (v: typeof values) => {
    const result = createCategoryBody.safeParse(v);
    const found: Partial<Record<Field, string>> = {};
    for (const issue of result.error?.issues ?? []) {
      const field = issue.path[0] as Field;
      found[field] ??= issue.message;
    }
    return { body: result.data, found };
  };

  const save = useMutation({
    mutationFn: (body: { name: string; description: string | null }) =>
      category ? api.patch<Category>(`/categories/${category.id}`, body) : api.post<Category>('/categories', body),
    onSuccess: () => {
      toast.success(category ? 'Category updated' : 'Category created');
      void queryClient.invalidateQueries({ queryKey: CATEGORIES });
      if (category) void queryClient.invalidateQueries({ queryKey: PRODUCTS });
      close();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) return setErrors({ name: err.message });
      if (err instanceof ApiError && err.status === 400 && Array.isArray(err.details)) {
        const found: Partial<Record<Field, string>> = {};
        for (const d of err.details as { path: string; message: string }[]) {
          if (d.path === 'name' || d.path === 'description') found[d.path] ??= d.message;
        }
        if (Object.keys(found).length > 0) return setErrors(found);
      }
      toast.error(err);
    },
  });

  const close = () => {
    onClose();
    if (!category) {
      setValues(initial);
      setErrors({});
      setSubmitted(false);
    }
  };

  const submit = () => {
    setSubmitted(true);
    const { body, found } = check(values);
    setErrors(found);
    if (body) save.mutate({ name: body.name, description: body.description ?? null });
  };

  const prefix = category ? 'edit-category' : 'new-category';
  const control = (field: Field) => ({
    id: `${prefix}-${field}`,
    value: values[field],
    onChange: (e: { target: { value: string } }) => setValues({ ...values, [field]: e.target.value }),
    onBlur: () => submitted && setErrors(check(values).found),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${prefix}-${field}-error` : undefined,
  });

  return (
    <FormModal
      open={open}
      onClose={close}
      title={category ? 'Edit category' : 'New category'}
      submitLabel={category ? 'Save changes' : 'Create category'}
      pendingLabel={category ? 'Saving…' : 'Creating…'}
      pending={save.isPending}
      onSubmit={submit}
    >
      <FormField id={`${prefix}-name`} label="Name" error={errors.name}>
        <input type="text" maxLength={120} autoComplete="off" className={textInputClass} {...control('name')} />
      </FormField>
      {category && (
        <FormField id="edit-category-slug" label="Slug">
          <input
            id="edit-category-slug"
            type="text"
            readOnly
            value={category.slug}
            className={`${textInputClass} text-text-secondary`}
          />
        </FormField>
      )}
      <FormField id={`${prefix}-description`} label="Description (optional)" error={errors.description}>
        <textarea maxLength={500} className={textAreaClass} {...control('description')} />
      </FormField>
    </FormModal>
  );
}
