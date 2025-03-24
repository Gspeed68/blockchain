# blockchain tutorial for Udemy class

# Initializing our blockchain list
blockchain = []

# function to get the current blockchain variable
def get_last_blockchain_value():
    """ Returns the last value of the blockchain """
    if len(blockchain) < 1:
        return None
    return blockchain [-1]


def add_value(transaction_amount, last_transaction=[1]):
    """ Append a new value as well as the last blockchain value to the blockchain
    
    Arguments:
      :transaction_amount: the amount that should be added.
      :last_transaction: the last blockchain transaction (default [1]).
     """
    blockchain.append([last_transaction, transaction_amount])
   
def get_transaction_value():
    """ Returns the input of the user (a new transaction amount) as a float."""
    user_input  = float(input('Your transaction amount please: '))
    return user_input

def get_user_choice():
    user_input = input('Your Choice: ')
    return user_input

def print_blockchain_elements():
    # Output the blockchain list to the console
    for block in blockchain:
        print('Outputting Block')
        print(block)

#def verify_chain():
 #   block_index = 0
#  is_valid = True
 #   for blockchain in blockchain:
  #      print(block)
   #     if block[0] == blockchain[block_index - 1]




while True:
    print('Please choose')
    print('1: Add a new transaction value')
    print('2: Output the blockchain blocks')
    print('h: Manipulate the chain')
    print('q: Quit')
    user_choice = get_user_choice()
    if user_choice == '1':
        tx_amount = get_transaction_value()
        add_value(tx_amount, get_last_blockchain_value())
    elif user_choice == '2':
            print_blockchain_elements()
    elif user_choice == 'h':
            if len(blockchain) >= 1:
#    elif user_choice == 'q':
#            break
        #else:
            #print('Input was invalid please pick an output from the list!')
    #print('Choice was registered')



# Output the blockchain list to the console
for block in blockchain:
    print('Outputting Block')
    print(block)

print('Done')

