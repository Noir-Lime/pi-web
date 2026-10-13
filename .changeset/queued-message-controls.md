---
"@jmfederico/pi-web": patch
---

Add copy, recall, remove, and Steer/Queue controls to pending session messages. Recall restores only the text and clears later messages in delivery order, with an attachment-loss warning only when the recalled message has attachments. Switching modes appends to the destination queue. Show attachment indicators and counts on queued messages without loading previews. When the runtime cannot safely support individual queue controls, disable Recall, Remove, and Steer/Queue switches and show the reason while keeping Copy and Clear queue available.
