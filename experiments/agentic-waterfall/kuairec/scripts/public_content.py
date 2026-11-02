"""Shared public caption projection for catalog and history records."""
import hashlib


def item_record(video_id, row):
    fields={k:('' if str(val) in ['UNKNOWN','[]'] else str(val)) for k,val in row.items() if k in ['manual_cover_text','caption','topic_tag'] or k.endswith('_category_name')}
    caption=fields.get('caption','')
    category=' / '.join(val for key,val in fields.items() if 'category' in key and val)
    body=' '.join(v for v in fields.values() if v)
    return {'id':str(int(video_id)),'source_id':'kuairec','content_type':'video','title':caption or category or f'KuaiRec video {video_id}','text':body,'category':category,'content_sha256':hashlib.sha256(body.encode()).hexdigest(),'metadata_version':'zenodo-18164998-caption-2024'}
