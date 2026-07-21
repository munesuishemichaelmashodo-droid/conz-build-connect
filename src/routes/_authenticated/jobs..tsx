
function ProofUpload({ jobId, kind, label, hint, onUploaded }: { jobId: string; kind: "pickup" | "delivery"; label: string; hint?: string; onUploaded: () => void | Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    const path = `${jobId}/${kind}.jpg`;
    const { error: uerr } = await supabase.storage
      .from("job-proof-photos")
      .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
    if (uerr) { setUploading(false); return toast.error(uerr.message); }
    const { data: pub } = supabase.storage.from("job-proof-photos").getPublicUrl(path);
    const url = `${pub.publicUrl}?t=${Date.now()}`;
    const patch = kind === "pickup" ? { pickup_photo_url: url } : { delivery_photo_url: url };
    const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
    setUploading(false);
    if (error) return toast.error(error.message);
    toast.success(`${label} photo uploaded`);
    await onUploaded();
  };
  return (
    <div className="rounded-2xl border p-4 space-y-3 bg-card">
      <div className="flex items-center gap-2">
        <PackageCheck className="w-5 h-5 text-primary" />
        <div className="font-display font-bold uppercase text-sm tracking-wide">{label}</div>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 hover:bg-muted transition p-3 cursor-pointer">
          <Camera className="w-5 h-5 text-primary shrink-0" />
          <span className="text-xs font-semibold">{uploading ? "Uploading…" : "Take photo"}</span>
          <input type="file" accept="image/*" capture="environment" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="hidden" />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 hover:bg-muted transition p-3 cursor-pointer">
          <ImageIcon className="w-5 h-5 text-primary shrink-0" />
          <span className="text-xs font-semibold">{uploading ? "Uploading…" : "Choose from gallery"}</span>
          <input type="file" accept="image/*" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="hidden" />
        </label>
      </div>
    </div>
  );
}
