import os
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

import uvicorn
from fastapi import FastAPI, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, Integer, String, TIMESTAMP, ForeignKey, DECIMAL, func, extract, case
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from slowapi import Limiter, _rate_limit_exceeded_handler

from slowapi.util import get_remote_address

from slowapi.errors import RateLimitExceeded
# --- Configuration ---
# Reads the database URL from an environment variable for deployment
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./parkinglot.db")
SECRET_KEY = "a_very_secret_key_for_jwt"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

# --- Database Setup ---
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- Password Hashing ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

# --- FastAPI App Initialization ---
app = FastAPI(
    title="Parking Lot Management API",
    description="API for a comprehensive parking lot management system.",
    version="1.0.0",
)
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"], # Allows all methods
    allow_headers=["*"], # Allows all headers
)
@app.middleware("http")
async def add_no_cache_header(request: Request, call_next):
    response = await call_next(request)
    # Check if the requested URL path is for a protected admin page
    if "/admin" in request.url.path or "/reports" in request.url.path:
        response.headers["Cache-Control"] = "no-store"
    return response

@app.api_route("/", methods=["GET", "HEAD"])
def read_root():
    return {"status": "ok", "message": "Parking Management API is running."}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"], 

)
# --- SQLAlchemy ORM Models ---
class ParkingLot(Base):
    __tablename__ = "ParkingLot"
    lot_id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)
    spots = relationship("ParkingSpot", back_populates="lot")

class ParkingSpot(Base):
    __tablename__ = "ParkingSpot"
    spot_id = Column(Integer, primary_key=True, index=True)
    lot_id = Column(Integer, ForeignKey("ParkingLot.lot_id"), nullable=False)
    spot_number = Column(String(50), nullable=False)
    spot_size = Column(String(50), nullable=False) # e.g., Compact, Large, Motorcycle
    status = Column(String(50), nullable=False, default='available') # e.g., available, occupied
    lot = relationship("ParkingLot", back_populates="spots")
    tickets = relationship("Ticket", back_populates="spot")

class Vehicle(Base):
    __tablename__ = "Vehicle"
    vehicle_id = Column(Integer, primary_key=True, index=True)
    vehicle_number = Column(String(50), nullable=False, unique=True, index=True)
    vehicle_type = Column(String(50), nullable=False)
    tickets = relationship("Ticket", back_populates="vehicle")

class Ticket(Base):
    __tablename__ = "Ticket"
    ticket_id = Column(Integer, primary_key=True, index=True)
    vehicle_id = Column(Integer, ForeignKey("Vehicle.vehicle_id"), nullable=False)
    spot_id = Column(Integer, ForeignKey("ParkingSpot.spot_id"), nullable=False)
    entry_time = Column(TIMESTAMP, nullable=False, default=datetime.utcnow)
    exit_time = Column(TIMESTAMP, nullable=True)
    status = Column(String(50), nullable=False, default='active') # e.g., active, paid, expired
    vehicle = relationship("Vehicle", back_populates="tickets")
    spot = relationship("ParkingSpot", back_populates="tickets")
    payment = relationship("Payment", back_populates="ticket", uselist=False)

class SystemUser(Base):
    __tablename__ = "SystemUser"
    user_id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False) # e.g., Administrator, Attendant

class Penalty(Base):
    __tablename__ = "Penalty"
    penalty_id = Column(Integer, primary_key=True, index=True)
    penalty_type = Column(String(100), nullable=False, unique=True)
    amount = Column(DECIMAL(10, 2), nullable=False)

class Payment(Base):
    __tablename__ = "Payment"
    payment_id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("Ticket.ticket_id"), nullable=False, unique=True)
    base_fee = Column(DECIMAL(10, 2), nullable=False)
    penalty_id = Column(Integer, ForeignKey("Penalty.penalty_id"), nullable=True)
    total_amount = Column(DECIMAL(10, 2), nullable=False)
    payment_method = Column(String(50), nullable=False)
    payment_status = Column(String(50), nullable=False) # e.g., successful, failed
    transaction_time = Column(TIMESTAMP, nullable=False, default=datetime.utcnow)
    processed_by_user_id = Column(Integer, ForeignKey("SystemUser.user_id"), nullable=True)
    ticket = relationship("Ticket", back_populates="payment")
    penalty = relationship("Penalty")
    processor = relationship("SystemUser")

# --- Pydantic Models ---

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None

class AuthResponse(BaseModel):
    access_token: str
    user_role: str
    token_expiry: datetime

# Entry
class EntryConfigResponse(BaseModel):
    fee_structure_details: Dict[str, Any]
    supported_vehicle_types: List[str]

class EntryTicketRequest(BaseModel):
    vehicle_number: str
    vehicle_type: str

class EntryTicketResponse(BaseModel):
    ticket_id: int
    spot_id: int
    spot_number: str
    entry_time: datetime
    qr_code_data: str

# Exit
class ExitDetailsResponse(BaseModel):
    ticket_id: int
    vehicle_number: str
    entry_time: datetime
    current_time: datetime
    duration_minutes: int
    calculated_fee: float

class ExitPaymentRequest(BaseModel):
    ticket_id: int
    amount_paid: float
    payment_method: str

class ExitPaymentResponse(BaseModel):
    payment_id: int
    payment_status: str
    transaction_time: datetime
    message: str

# Admin Dashboard
class DashboardSummaryResponse(BaseModel):
    total_spots: int
    occupied_spots: int
    available_spots: int
    breakdown_by_lot: Dict[str, Dict[str, int]]
    breakdown_by_size: Dict[str, int]
class DashboardTrendsResponse(BaseModel):
    labels: List[str]  # e.g., ["Mon", "Tue", "Wed"]
    entries_data: List[int]
    exits_data: List[int]
# Admin Lot Map
class SpotStatus(BaseModel):
    spot_id: int
    spot_number: str
    status: str
    spot_size: str

class LotMapResponse(BaseModel):
    lot_id: int
    lot_name: str
    spots_array: List[SpotStatus]

# Admin Tickets
class TicketResponse(BaseModel):
    ticket_id: int
    vehicle_number: str
    vehicle_type: str
    spot_number: str
    lot_name: str
    entry_time: datetime
    exit_time: Optional[datetime]  
    total_amount: Optional[float]  
    status: str
    class Config:
        from_attributes = True

class PaymentDetail(BaseModel):
    payment_id: int
    base_fee: float
    penalty_amount: Optional[float]
    total_amount: float
    payment_method: str
    payment_status: str
    transaction_time: datetime
    class Config:
        from_attributes = True

class TicketDetailResponse(BaseModel):
    ticket_id: int
    vehicle_number: str
    vehicle_type: str
    spot_number: str
    lot_name: str
    entry_time: datetime
    exit_time: Optional[datetime]
    status: str
    payment_details: Optional[PaymentDetail]

# Admin Assisted Exit
class AssistedExitRequest(BaseModel):
    vehicle_number: str
    exit_reason: str # LOST_TICKET, NO_RECORD_FOUND
    payment_method: str
    amount_paid: float
    processed_by_user_id: int

class AssistedExitResponse(BaseModel):
    payment_id: Optional[int]
    payment_status: str
    total_amount_charged: float
    base_fee: float
    penalty_applied: Optional[float]
    message: str

# Admin Reports
class RevenueReportResponse(BaseModel):
    report_period: Dict[str, datetime]
    total_revenue: float
    total_transactions: int
    average_ticket: float
    revenue_by_payment_method: Dict[str, float]
    revenue_by_lot: Dict[str, float]
    revenue_from_penalties: float

class OccupancyReportResponse(BaseModel):
    report_period: Dict[str, datetime]
    peak_hours_data: Dict[int, int] # Hour -> Count
    occupancy_by_lot: Dict[str, float] # Lot Name -> Average Occupancy %
    average_duration_by_vehicle_type: Dict[str, float] # Type -> Avg minutes



# --- Database Dependency ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Utility Functions ---
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def calculate_fee(duration_minutes: int, vehicle_type: str) -> float:
    if duration_minutes <= 0:
        return 0.0
    # Define pricing tiers
    pricing = {
        "Motorcycle": {"first_hour": 10.0, "subsequent_hour": 5.0},
        "Compact": {"first_hour": 25.0, "subsequent_hour": 12.0},
        "Large": {"first_hour": 50.0, "subsequent_hour": 25.0}
    }
    # Default to Compact pricing if type is unknown
    rates = pricing.get(vehicle_type, pricing["Compact"])
    hours = (duration_minutes + 59) // 60  
    if hours <= 1:
        return rates["first_hour"]
    return rates["first_hour"] + (hours - 1) * rates["subsequent_hour"]

# --- Authentication and Authorization ---
async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> SystemUser:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = db.query(SystemUser).filter(SystemUser.username == token_data.username).first()
    if user is None:
        raise credentials_exception
    return user

async def get_current_admin_user(current_user: SystemUser = Depends(get_current_user)) -> SystemUser:
    if current_user.role != "Administrator":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user does not have enough privileges"
        )
    return current_user


# --- API Endpoints ---

# Authentication Router
auth_router = FastAPI().router

@auth_router.post("/auth/login", response_model=AuthResponse)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(SystemUser).filter(SystemUser.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    expire_time = datetime.utcnow() + access_token_expires
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role},
        expires_delta=access_token_expires
    )
    return {
        "access_token": access_token,
        "user_role": user.role,
        "token_expiry": expire_time
    }

# Entry Terminal Router
entry_router = FastAPI().router

@entry_router.get("/entry/config", response_model=EntryConfigResponse)
async def get_entry_config():
    return {
        "fee_structure_details": {
            "Motorcycle": {"first_hour": 10.0, "subsequent_hour": 5.0, "lost_ticket_penalty": 100.0},
            "Compact": {"first_hour": 25.0, "subsequent_hour": 12.0, "lost_ticket_penalty": 250.0},
            "Large": {"first_hour": 50.0, "subsequent_hour": 25.0, "lost_ticket_penalty": 500.0}
        },
        "supported_vehicle_types": ["Motorcycle", "Compact", "Large"]
    }
VALID_STATE_CODES = {
    "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DD", "DL", "GA", "GJ", "HR",
    "HP", "JK", "JH", "KA", "KL", "LA", "LD", "MP", "MH", "MN", "ML", "MZ",
    "NL", "OD", "PY", "PB", "RJ", "SK", "TN", "TS", "TR", "UP", "UK", "WB"
}
@entry_router.post("/entry/ticket", response_model=EntryTicketResponse, status_code=status.HTTP_201_CREATED)
async def create_ticket(request: EntryTicketRequest, db: Session = Depends(get_db)):
    vehicle_number = request.vehicle_number.strip().upper()
    if len(vehicle_number) < 2 or vehicle_number[:2] not in VALID_STATE_CODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid vehicle number. Must start with a valid 2-letter state code (e.g., UP, DL, MH)."
        )
    # Map vehicle type to spot size
    size_map = {"Motorcycle": "Motorcycle", "Compact": "Compact", "Large": "Large"}
    required_size = size_map.get(request.vehicle_type)
    if not required_size:
        raise HTTPException(status_code=400, detail="Unsupported vehicle type")

    # Find an available spot
    available_spot = db.query(ParkingSpot).filter(
        ParkingSpot.spot_size == required_size,
        ParkingSpot.status == 'available'
    ).first()

    if not available_spot:
        raise HTTPException(status_code=404, detail=f"No available spots for vehicle type: {request.vehicle_type}")

    # Get or create vehicle
    vehicle = db.query(Vehicle).filter(Vehicle.vehicle_number == request.vehicle_number).first()
    if not vehicle:
        vehicle = Vehicle(vehicle_number=request.vehicle_number, vehicle_type=request.vehicle_type)
        db.add(vehicle)
        db.flush()
    existing_active_ticket = db.query(Ticket).filter(
        Ticket.vehicle_id == vehicle.vehicle_id,
        Ticket.status == 'active'
    ).first()

    if existing_active_ticket:
        raise HTTPException(status_code=409, detail=f"Vehicle {request.vehicle_number} is already parked.")
    # Create ticket and update spot status
    new_ticket = Ticket(vehicle_id=vehicle.vehicle_id, spot_id=available_spot.spot_id)
    available_spot.status = 'occupied'
    db.add(new_ticket)
    db.commit()
    db.refresh(new_ticket)

    return {
        "ticket_id": new_ticket.ticket_id,
        "spot_id": available_spot.spot_id,
        "spot_number": available_spot.spot_number,
        "entry_time": new_ticket.entry_time,
        "qr_code_data": str(new_ticket.ticket_id)
    }

# Exit Terminal Router
exit_router = FastAPI().router

@exit_router.get("/exit/details/{ticket_id}", response_model=ExitDetailsResponse)
async def get_exit_details(ticket_id: int, db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.ticket_id == ticket_id).first()
    if not ticket or ticket.status != 'active':
        raise HTTPException(status_code=404, detail="Active ticket not found")

    current_time = datetime.utcnow()
    duration = current_time - ticket.entry_time
    duration_minutes = int(duration.total_seconds() / 60)
    fee = calculate_fee(duration_minutes, ticket.vehicle.vehicle_type)

    return {
        "ticket_id": ticket.ticket_id,
        "vehicle_number": ticket.vehicle.vehicle_number,
        "entry_time": ticket.entry_time,
        "current_time": current_time,
        "duration_minutes": duration_minutes,
        "calculated_fee": fee
    }

@exit_router.post("/exit/payment", response_model=ExitPaymentResponse)
async def process_payment(request: ExitPaymentRequest, db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.ticket_id == request.ticket_id).first()
    if not ticket or ticket.status != 'active':
        raise HTTPException(status_code=404, detail="Active ticket not found")

    current_time = datetime.utcnow()
    duration = current_time - ticket.entry_time
    duration_minutes = int(duration.total_seconds() / 60)
    vehicle_type = ticket.vehicle.vehicle_type
    fee = calculate_fee(duration_minutes, vehicle_type)

    if request.amount_paid < fee:
        raise HTTPException(status_code=400, detail=f"Insufficient payment. Required: {fee}, Paid: {request.amount_paid}")

    # Create payment record
    payment = Payment(
        ticket_id=ticket.ticket_id,
        base_fee=fee,
        total_amount=request.amount_paid,
        payment_method=request.payment_method,
        payment_status='successful'
    )
    db.add(payment)

    # Update ticket and spot
    ticket.exit_time = current_time
    ticket.status = 'paid'
    spot = db.query(ParkingSpot).filter(ParkingSpot.spot_id == ticket.spot_id).first()
    if spot:
        spot.status = 'available'

    db.commit()
    db.refresh(payment)

    return {
        "payment_id": payment.payment_id,
        "payment_status": payment.payment_status,
        "transaction_time": payment.transaction_time,
        "message": "Payment successful. Thank you!"
    }

# Admin Router
admin_router = FastAPI().router

@admin_router.get("/dashboard/summary", response_model=DashboardSummaryResponse, dependencies=[Depends(get_current_admin_user)])
async def get_dashboard_summary(db: Session = Depends(get_db)):
    total_spots = db.query(ParkingSpot).count()
    occupied_spots = db.query(ParkingSpot).filter(ParkingSpot.status == 'occupied').count()
    lot_breakdown_query = db.query(
        ParkingLot.name, 
        func.count(ParkingSpot.spot_id).label('total'),
        func.sum(case((ParkingSpot.status == 'occupied', 1), else_=0)).label('occupied')
    ).join(ParkingSpot).group_by(ParkingLot.name).all()
    
    breakdown_by_lot = {name: {"total": total, "occupied": occupied or 0} for name, total, occupied in lot_breakdown_query}
    
    size_breakdown_query = db.query(ParkingSpot.spot_size, func.count(ParkingSpot.spot_id)).group_by(ParkingSpot.spot_size).all()
    breakdown_by_size = {size: count for size, count in size_breakdown_query}

    return {
        "total_spots": total_spots,
        "occupied_spots": occupied_spots,
        "available_spots": total_spots - occupied_spots,
        "breakdown_by_lot": breakdown_by_lot,
        "breakdown_by_size": breakdown_by_size
    }

# NEW: The trends endpoint for the charts
@admin_router.get("/dashboard/trends", response_model=DashboardTrendsResponse, dependencies=[Depends(get_current_admin_user)])
async def get_dashboard_trends(db: Session = Depends(get_db)):
    try:
        today = datetime.utcnow().date()
        seven_days_ago = today - timedelta(days=6)
        date_range = [seven_days_ago + timedelta(days=i) for i in range(7)]
        
        entries_query = db.query(
            func.date(Ticket.entry_time).label('date'),
            func.count(Ticket.ticket_id).label('count')
        ).filter(
            func.date(Ticket.entry_time).between(seven_days_ago, today)
        ).group_by(func.date(Ticket.entry_time)).all()
        
        exits_query = db.query(
            func.date(Ticket.exit_time).label('date'),
            func.count(Ticket.ticket_id).label('count')
        ).filter(
            Ticket.exit_time.isnot(None),
            func.date(Ticket.exit_time).between(seven_days_ago, today)
        ).group_by(func.date(Ticket.exit_time)).all()

        entries_dict = {entry.date: entry.count for entry in entries_query}
        exits_dict = {exit.date: exit.count for exit in exits_query}
        
        labels = [d.strftime("%a") for d in date_range]
        entries_data = [entries_dict.get(d.isoformat(), 0) for d in date_range]
        exits_data = [exits_dict.get(d.isoformat(), 0) for d in date_range]

        return {
            "labels": labels,
            "entries_data": entries_data,
            "exits_data": exits_data
        }
    except Exception as e: # <-- ADD THIS EXCEPT BLOCK
        print(f"An error occurred in get_dashboard_trends: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An internal error occurred: {str(e)}"
        )

@admin_router.get("/parking-lots/{lot_id}/map", response_model=LotMapResponse, dependencies=[Depends(get_current_admin_user)])
async def get_lot_map(lot_id: int, db: Session = Depends(get_db)):
    lot = db.query(ParkingLot).filter(ParkingLot.lot_id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Parking lot not found")
    
    spots = db.query(ParkingSpot).filter(ParkingSpot.lot_id == lot_id).order_by(ParkingSpot.spot_number).all()
    
    return {
        "lot_id": lot.lot_id,
        "lot_name": lot.name,
        "spots_array": spots
    }


# In main.py, REPLACE the entire get_tickets function with this one
# In main.py, REPLACE the entire get_tickets function

@admin_router.get("/tickets", response_model=List[TicketResponse], dependencies=[Depends(get_current_admin_user)])
async def get_tickets(
    status: Optional[str] = Query(None, description="Filter by status e.g., 'active', 'paid'"),
    vehicle_number: Optional[str] = Query(None, description="Filter by vehicle number"),
    spot_id: Optional[int] = Query(None, description="Filter by spot ID"),
    sort_by: Optional[str] = Query('entry_time_desc', description="Sort order e.g., 'entry_time_desc'"),
    db: Session = Depends(get_db)
):
    try:
        query = db.query(
            Ticket, 
            Payment.total_amount
        ).outerjoin(Payment, Ticket.ticket_id == Payment.ticket_id) \
         .join(Vehicle, Ticket.vehicle_id == Vehicle.vehicle_id) \
         .join(ParkingSpot, Ticket.spot_id == ParkingSpot.spot_id) \
         .join(ParkingLot, ParkingSpot.lot_id == ParkingLot.lot_id)

        if status:
            query = query.filter(Ticket.status == status)
        if vehicle_number:
            query = query.filter(Vehicle.vehicle_number.ilike(f"%{vehicle_number}%"))
        if spot_id:
            query = query.filter(Ticket.spot_id == spot_id)

        if sort_by == 'entry_time_desc':
            query = query.order_by(Ticket.entry_time.desc())
        elif sort_by == 'entry_time_asc':
            query = query.order_by(Ticket.entry_time.asc())

        ticket_results = query.limit(100).all()
        
        response = []
        current_time = datetime.utcnow() # Get current time once for consistency

        for t, db_total_amount in ticket_results:
            final_amount = db_total_amount

            # --- NEW LOGIC: If the ticket is active, calculate the current fee ---
            if t.status == 'active':
                duration = current_time - t.entry_time
                duration_minutes = int(duration.total_seconds() / 60)
                final_amount = calculate_fee(duration_minutes, t.vehicle.vehicle_type)
            # --- END OF NEW LOGIC ---

            response.append({
                "ticket_id": t.ticket_id,
                "vehicle_number": t.vehicle.vehicle_number,
                "vehicle_type": t.vehicle.vehicle_type,
                "spot_number": t.spot.spot_number,
                "lot_name": t.spot.lot.name,
                "entry_time": t.entry_time,
                "exit_time": t.exit_time,
                "total_amount": final_amount, # Use either the DB amount or the newly calculated one
                "status": t.status
            })
        return response

    except Exception as e:
        print(f"An error occurred in get_tickets: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An internal error occurred while fetching tickets: {str(e)}"
        )

@admin_router.post("/exit/assisted", response_model=AssistedExitResponse, dependencies=[Depends(get_current_admin_user)])
async def assisted_exit(request: AssistedExitRequest, db: Session = Depends(get_db)):
    ticket = db.query(Ticket).join(Vehicle).filter(
        Vehicle.vehicle_number == request.vehicle_number,
        Ticket.status == 'active'
    ).first()

    if not ticket and request.exit_reason != 'NO_RECORD_FOUND':
        raise HTTPException(status_code=404, detail="Active ticket for this vehicle not found.")

    if request.exit_reason == 'NO_RECORD_FOUND' and ticket:
        raise HTTPException(status_code=400, detail="Found an active ticket. Please use LOST_TICKET reason instead.")

    base_fee = 0.0
    penalty_amount = 0.0
    penalty = None
    current_time = datetime.utcnow()
    vehicle_type = ticket.vehicle.vehicle_type 

    if ticket:
        duration = current_time - ticket.entry_time
        duration_minutes = int(duration.total_seconds() / 60)
        base_fee = calculate_fee(duration_minutes,vehicle_type)

    if request.exit_reason == 'LOST_TICKET':
        penalty_type_str = f"LOST_TICKET_{vehicle_type.upper()}"
        penalty = db.query(Penalty).filter(Penalty.penalty_type == penalty_type_str).first()
        if penalty:
            penalty_amount = penalty.amount
    
    # CORRECTED LINE: Convert penalty_amount to float before adding
    total_charge = base_fee + float(penalty_amount)
    
    # if request.amount_paid < total_charge:
    #     raise HTTPException(status_code=400, detail=f"Insufficient payment. Required: {total_charge}")

    payment = Payment(
        ticket_id=ticket.ticket_id if ticket else None,
        base_fee=base_fee,
        penalty_id=penalty.penalty_id if penalty else None,
        total_amount=request.amount_paid,
        payment_method=request.payment_method,
        payment_status='successful',
        processed_by_user_id=request.processed_by_user_id
    )
    db.add(payment)
    
    if ticket:
        ticket.exit_time = current_time
        ticket.status = 'paid'
        spot = db.query(ParkingSpot).filter(ParkingSpot.spot_id == ticket.spot_id).first()
        if spot: spot.status = 'available'

    db.commit()
    db.refresh(payment)

    return {
        "payment_id": payment.payment_id,
        "payment_status": 'successful',
        "total_amount_charged": total_charge,
        "base_fee": base_fee,
        "penalty_applied": float(penalty_amount) if penalty_amount > 0 else None,
        "message": "Assisted exit processed successfully."
    }
@admin_router.get("/reports/revenue", response_model=RevenueReportResponse, dependencies=[Depends(get_current_admin_user)])
async def get_revenue_report(
    start_date: datetime, 
    end_date: datetime, 
    db: Session = Depends(get_db)
):
    payments_query = db.query(Payment).filter(Payment.transaction_time.between(start_date, end_date))
    total_transactions = payments_query.count()
    total_revenue = payments_query.with_entities(func.sum(Payment.total_amount)).scalar() or 0
    average_ticket = (total_revenue / total_transactions) if total_transactions > 0 else 0.0

    revenue_by_method = db.query(
        Payment.payment_method,
        func.sum(Payment.total_amount)
    ).filter(Payment.transaction_time.between(start_date, end_date)).group_by(Payment.payment_method).all()

    revenue_by_lot = db.query(
        ParkingLot.name,
        func.sum(Payment.base_fee)
    ).join(Ticket).join(ParkingSpot).join(ParkingLot).filter(Payment.transaction_time.between(start_date, end_date)).group_by(ParkingLot.name).all()

    revenue_from_penalties = db.query(func.sum(Penalty.amount)).join(Payment).filter(
        Payment.transaction_time.between(start_date, end_date),
        Payment.penalty_id.isnot(None)
    ).scalar() or 0

    return {
        "report_period": {"start_date": start_date, "end_date": end_date},
        "total_revenue": total_revenue,
        "total_transactions": total_transactions, # Add to response
        "average_ticket": average_ticket, 
        "revenue_by_payment_method": dict(revenue_by_method),
        "revenue_by_lot": dict(revenue_by_lot),
        "revenue_from_penalties": revenue_from_penalties
    }

# In main.py, replace the whole function with this corrected version

@admin_router.get("/reports/occupancy", response_model=OccupancyReportResponse, dependencies=[Depends(get_current_admin_user)], tags=["Administration"])
async def get_occupancy_report(
    start_date: datetime, 
    end_date: datetime, 
    db: Session = Depends(get_db)
):
    peak_hours_query = db.query(
        extract('hour', Ticket.entry_time).label('hour'),
        func.count(Ticket.ticket_id).label('count')
    ).filter(Ticket.entry_time.between(start_date, end_date)).group_by('hour').order_by('hour').all()

    if engine.dialect.name == "postgresql":
        duration_calc = func.avg(extract('epoch', Ticket.exit_time) - extract('epoch', Ticket.entry_time)) / 60
    else: # SQLite
        duration_calc = func.avg(func.julianday(Ticket.exit_time) - func.julianday(Ticket.entry_time)) * 24 * 60

    avg_duration_query = db.query(
        Vehicle.vehicle_type,
        duration_calc.label('avg_duration')
    ).join(Vehicle, Ticket.vehicle_id == Vehicle.vehicle_id).filter(
        Ticket.exit_time.isnot(None),
        Ticket.entry_time.between(start_date, end_date)
    ).group_by(Vehicle.vehicle_type).all()
    
    # CORRECTED QUERY: We explicitly tell SQLAlchemy how to join the tables
    occupancy_by_lot_raw = db.query(
        ParkingLot.name, 
        func.count(Ticket.ticket_id)
    ).join(ParkingSpot, Ticket.spot_id == ParkingSpot.spot_id) \
     .join(ParkingLot, ParkingSpot.lot_id == ParkingLot.lot_id) \
     .filter(Ticket.entry_time.between(start_date, end_date)) \
     .group_by(ParkingLot.name).all()

    return {
        "report_period": {"start_date": start_date, "end_date": end_date},
        "peak_hours_data": dict(peak_hours_query),
        "occupancy_by_lot": dict(occupancy_by_lot_raw),
        "average_duration_by_vehicle_type": dict(avg_duration_query)
    }

# --- App Router Integration ---
app.include_router(auth_router, tags=["Authentication"])
app.include_router(entry_router, tags=["Entry Terminal"])
app.include_router(exit_router, tags=["Exit Terminal"])
app.include_router(admin_router, prefix="/admin", tags=["Administration"])

# --- Application Startup Event ---
@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    print("--- Attempting to connect to the database... ---")
    db = SessionLocal()
    try:
        # Create users if they don't exist
        print("--- Database connection established successfully. Initializing data... ---")
        made_changes = False
        if not db.query(SystemUser).first():
            db.add(SystemUser(username="admin", password_hash=get_password_hash("admin123"), role="Administrator"))
            db.add(SystemUser(username="attendant1", password_hash=get_password_hash("attendant123"), role="Attendant"))
            db.add(SystemUser(username="attendant2", password_hash=get_password_hash("attendant123"), role="Attendant"))
            db.add(SystemUser(username="manager", password_hash=get_password_hash("manager123"), role="manager"))
            db.add(SystemUser(username="records", password_hash=get_password_hash("records123"), role="records"))

        # Create lots and spots if they don't exist
        if not db.query(ParkingLot).first():
            lot_a = ParkingLot(name="Main Lot A")
            lot_b = ParkingLot(name="Overflow Lot B")
            lot_c = ParkingLot(name="Economy Lot C")
            db.add_all([lot_a, lot_b, lot_c])
            db.flush() # This assigns the IDs to lot_a, lot_b, and lot_c

            spots_to_add = []
            # Add 100 spots to Lot A
            for i in range(1, 41): spots_to_add.append(ParkingSpot(lot_id=lot_a.lot_id, spot_number=f"A{i}", spot_size="Motorcycle"))
            for i in range(41, 71): spots_to_add.append(ParkingSpot(lot_id=lot_a.lot_id, spot_number=f"A{i}", spot_size="Compact"))
            for i in range(71, 101): spots_to_add.append(ParkingSpot(lot_id=lot_a.lot_id, spot_number=f"A{i}", spot_size="Large"))
            
            # Add 30 spots to Lot B
            for i in range(1, 31): spots_to_add.append(ParkingSpot(lot_id=lot_b.lot_id, spot_number=f"B{i}", spot_size="Motorcycle"))
            for i in range(41, 71): spots_to_add.append(ParkingSpot(lot_id=lot_b.lot_id, spot_number=f"B{i}", spot_size="Compact"))
            for i in range(71, 31): spots_to_add.append(ParkingSpot(lot_id=lot_b.lot_id, spot_number=f"B{i}", spot_size="Large"))
            
            # Add 30 spots to Lot C
            for i in range(1, 41): spots_to_add.append(ParkingSpot(lot_id=lot_c.lot_id, spot_number=f"C{i}", spot_size="Motorcycle"))
            for i in range(41, 71): spots_to_add.append(ParkingSpot(lot_id=lot_c.lot_id, spot_number=f"C{i}", spot_size="Compact"))
            for i in range(71, 101): spots_to_add.append(ParkingSpot(lot_id=lot_c.lot_id, spot_number=f"C{i}", spot_size="Large"))
            db.bulk_save_objects(spots_to_add)
            made_changes = True

        if not db.query(Penalty).first():
            db.add(Penalty(penalty_type="LOST_TICKET_MOTORCYCLE", amount=100.00))
            db.add(Penalty(penalty_type="LOST_TICKET_COMPACT", amount=250.00))
            db.add(Penalty(penalty_type="LOST_TICKET_LARGE", amount=500.00))
            made_changes = True

        if made_changes:
            db.commit()
            print("--- Initial data committed to the database. ---")

    finally:
        db.close()

# --- Main Entry Point for Running the App ---
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
