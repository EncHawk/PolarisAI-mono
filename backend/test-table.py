import os
from supabase import Client, create_client

key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkeWRvc3dna2xvemdpb3hzbGJ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1ODQyMiwiZXhwIjoyMTAwNTM0NDIyfQ.Y9LAkL9BAqT0m1r_8m6feeBdxcfOUE-8MUTkDytREXI"
url = "https://idydoswgklozgioxslbx.supabase.co"

client : Client = create_client(url,key)

response = (
    client.table("users")
    .select("*")
    .execute()
)

print(response)
