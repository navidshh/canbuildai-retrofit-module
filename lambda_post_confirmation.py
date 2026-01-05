import json
import boto3
import os
from botocore.exceptions import ClientError

# Initialize Cognito client
cognito_client = boto3.client('cognito-idp')

def lambda_handler(event, context):
    """
    Cognito PostConfirmation Lambda Trigger
    This function is called after a user confirms their account (email verification)
    """
    
    print(f"PostConfirmation event: {json.dumps(event)}")
    
    try:
        # Extract user information from the event
        user_pool_id = event['userPoolId']
        username = event['userName']
        user_attributes = event['request']['userAttributes']
        
        print(f"User {username} confirmed in pool {user_pool_id}")
        print(f"User attributes: {json.dumps(user_attributes)}")
        
        # Get email from attributes
        email = user_attributes.get('email', 'N/A')
        name = user_attributes.get('name', 'N/A')
        
        print(f"Confirmed user: {name} ({email})")
        
        # Optional: Add user to a default group after confirmation
        # Uncomment and modify if you want to add users to a group
        # try:
        #     cognito_client.admin_add_user_to_group(
        #         UserPoolId=user_pool_id,
        #         Username=username,
        #         GroupName='Users'  # Change to your group name
        #     )
        #     print(f"Added user {username} to Users group")
        # except ClientError as e:
        #     print(f"Error adding user to group: {e}")
        
        # Disable user after confirmation (requires admin approval)
        try:
            cognito_client.admin_disable_user(
                UserPoolId=user_pool_id,
                Username=username
            )
            print(f"Disabled user {username} - pending admin approval")
        except ClientError as e:
            print(f"Error disabling user: {e}")
        
        # Optional: Update user attributes
        # try:
        #     cognito_client.admin_update_user_attributes(
        #         UserPoolId=user_pool_id,
        #         Username=username,
        #         UserAttributes=[
        #             {
        #                 'Name': 'custom:verified',
        #                 'Value': 'true'
        #             }
        #         ]
        #     )
        #     print(f"Updated user attributes for {username}")
        # except ClientError as e:
        #     print(f"Error updating user attributes: {e}")
        
        # Optional: Send custom welcome email via SES
        # ses_client = boto3.client('ses')
        # try:
        #     ses_client.send_email(
        #         Source='noreply@yourdomain.com',
        #         Destination={'ToAddresses': [email]},
        #         Message={
        #             'Subject': {'Data': 'Welcome!'},
        #             'Body': {
        #                 'Text': {'Data': f'Welcome {name}! Your account has been confirmed.'}
        #             }
        #         }
        #     )
        #     print(f"Sent welcome email to {email}")
        # except ClientError as e:
        #     print(f"Error sending email: {e}")
        
        # Return the event to Cognito (required)
        return event
        
    except KeyError as e:
        print(f"Missing required field in event: {e}")
        # Return event even on error to not block user confirmation
        return event
        
    except Exception as e:
        print(f"Unexpected error in PostConfirmation: {e}")
        # Return event even on error to not block user confirmation
        return event
