"""Preserve publicly available ID when official item metadata is missing."""
class MissingItemAdapter:
    def __init__(self,tool):self.tool=tool;self.missing_item_ids=[];self.missing_user_ids=[]
    def get_user(self,user_id):
        user=self.tool.get_user(user_id=user_id)
        if user is None:
            if user_id not in self.missing_user_ids:self.missing_user_ids.append(user_id)
            return {'user_id':user_id}
        return user
    def get_item(self,item_id=None):
        item=self.tool.get_item(item_id=item_id)
        if item is None and item_id is not None:
            if item_id not in self.missing_item_ids:self.missing_item_ids.append(item_id)
            # shortcut: missing source metadata remains ID-only until an independently verified source is available.
            return {'item_id':item_id}
        return item
    def get_reviews(self,**kwargs):return self.tool.get_reviews(**kwargs)
