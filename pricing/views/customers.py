import logging

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from pricing.models_v2 import Customer
from pricing.serializers import CustomerSerializer

logger = logging.getLogger(__name__)


@api_view(['GET', 'POST'])
def customers_view(request):
    if request.method == 'GET':
        customers = Customer.objects.all()
        nospos_q = request.query_params.get('nospos_customer_id')
        if nospos_q is not None and str(nospos_q).strip() != '':
            try:
                customers = customers.filter(nospos_customer_id=int(nospos_q))
            except (TypeError, ValueError):
                customers = Customer.objects.none()
        data = [
            {
                "id": c.customer_id,
                "name": c.name,
                "phone": c.phone_number,
                "phone_number": c.phone_number,
                "email": c.email,
                "address": c.address,
                "nospos_customer_id": c.nospos_customer_id,
            }
            for c in customers
        ]
        return Response(data)

    elif request.method == 'POST':
        serializer = CustomerSerializer(data=request.data)
        if serializer.is_valid():
            customer = serializer.save()
            data = {
                "id": customer.customer_id,
                "name": customer.name,
                "phone": customer.phone_number,
                "email": customer.email,
                "address": customer.address or "",
                "cancel_rate": customer.cancel_rate,
                "nospos_customer_id": customer.nospos_customer_id,
            }
            return Response(data, status=status.HTTP_201_CREATED)
        logger.warning("CustomerSerializer errors: %s", serializer.errors)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PATCH', 'PUT'])
def customer_detail(request, customer_id):
    """Get or update a single customer."""
    try:
        customer = Customer.objects.get(customer_id=customer_id)
    except Customer.DoesNotExist:
        return Response({"error": "Customer not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        data = {
            "id": customer.customer_id,
            "name": customer.name,
            "phone": customer.phone_number,
            "email": customer.email,
            "address": customer.address or "",
            "cancel_rate": customer.cancel_rate,
            "nospos_customer_id": customer.nospos_customer_id,
        }
        return Response(data)

    elif request.method in ('PATCH', 'PUT'):
        data = request.data.copy()
        if 'phone' in data and 'phone_number' not in data:
            data['phone_number'] = data.pop('phone')
        serializer = CustomerSerializer(customer, data=data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
